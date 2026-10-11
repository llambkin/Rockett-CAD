import {
  LINEAR_TOL,
  SIZE_KEYS,
  ValidationError,
  type CadDocument,
  type EdgeRef,
  type SizeLimit,
  type SizedFeature,
  type Vec3,
} from "@rockett/shared";
import { TIMING_MS, TRIAL_BUDGET } from "../tunables.js";
import { trialBuild } from "./engine.js";
import { NoCorner, type EvalState } from "./features.js";
import {
  acquire,
  scoped,
  areaOf,
  bboxOf,
  diagonal,
  getKernel,
  lengthOf,
  listToArray,
  volumeOf,
} from "./kernel.js";
import { computeEdgeNames } from "./naming.js";
import { blendEdges } from "./blendEdges.js";
import { shelledBody } from "./shell.js";

class Untouched extends Error {}

const CLOSE_ENOUGH = 1.25;
const STEP = 4;

type Sized<T extends SizedFeature["type"]> = Extract<SizedFeature, { type: T }>;

interface Bound<F> {
  least?: true;
  trial?(feature: F): F;
  estimate(state: EvalState, feature: F): number;
  passes?(state: EvalState, feature: F): (built: EvalState) => boolean;
}

function edgeRoom(state: EvalState, refs: EdgeRef[]): number {
  return scoped(() => {
    const k = getKernel();
    let room = Infinity;
    for (const ref of refs) {
      const body = state.bodies.get(ref.bodyId);
      if (!body) throw new ValidationError(`body ${ref.bodyId} not found`);
      const byName = computeEdgeNames(body).byName;
      const map = acquire(new k.TopTools_IndexedDataMapOfShapeListOfShape_1());

      const edge = byName.get(ref.edgeName);
      if (!edge)
        throw new ValidationError(`edge ${ref.edgeName} no longer exists`);
      k.TopExp.MapShapesAndAncestors(
        body.shape,
        k.TopAbs_ShapeEnum.TopAbs_EDGE,
        k.TopAbs_ShapeEnum.TopAbs_FACE,
        map,
      );
      const faces = listToArray(map.FindFromIndex_2(map.FindIndex(edge)));
      const length = lengthOf(edge);
      for (const face of faces) room = Math.min(room, areaOf(face) / length);
    }
    return room;
  });
}

function blendRoom(state: EvalState, f: Sized<"fillet" | "chamfer">) {
  let refs: EdgeRef[];
  try {
    refs = blendEdges(state, f);
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  return edgeRoom(state, refs);
}

function reach(
  state: EvalState,
  bodyIds: Iterable<string>,
  points: Vec3[] = [],
): number {
  const corners = [...points];
  for (const id of bodyIds) {
    const body = state.bodies.get(id);
    if (!body) throw new ValidationError(`body ${id} not found`);
    const { min, max } = bboxOf(body.shape);
    corners.push(min, max);
  }
  const low = (axis: number) => Math.min(...corners.map((c) => c[axis]!));
  const high = (axis: number) => Math.max(...corners.map((c) => c[axis]!));
  return diagonal({
    min: [low(0), low(1), low(2)],
    max: [high(0), high(1), high(2)],
  });
}

function total(
  state: EvalState,
  bodyIds: Iterable<string> = state.bodies.keys(),
): number {
  let sum = 0;
  for (const id of bodyIds) sum += volumeOf(state.bodies.get(id)!.shape);
  return sum;
}

const same = (volume: number, expected: number) =>
  Math.abs(volume - expected) <= LINEAR_TOL * Math.max(expected, LINEAR_TOL);

const BOUNDS: { [T in SizedFeature["type"]]: Bound<Sized<T>> } = {
  fillet: { estimate: blendRoom },
  chamfer: { estimate: blendRoom },
  shell: {
    estimate(state, f) {
      const body = shelledBody(state, f);
      return (3 * volumeOf(body.shape)) / areaOf(body.shape);
    },
  },
  offsetFace: {
    estimate: (state, f) =>
      reach(
        state,
        f.faces.map((r) => r.bodyId),
      ),
  },
  extrude: {
    least: true,
    estimate(state, f) {
      const origins = f.profiles.flatMap((p) => {
        const sketch = state.sketches.get(p.sketchId);
        return sketch ? [sketch.frame.origin] : [];
      });
      return (
        2 *
        (reach(state, state.bodies.keys(), origins) +
          Math.abs(f.startOffset ?? 0))
      );
    },
    passes(state) {
      const before = total(state);
      let through: number | undefined;
      return (built) => {
        const volume = total(built);
        if (through === undefined && same(volume, before))
          throw new Untouched();
        through ??= volume;
        return same(volume, through);
      };
    },
  },
  linearPattern: {
    least: true,
    trial: (f) => ({ ...f, combine: true }),
    estimate: (state, f) => reach(state, f.bodies),
    passes(state, f) {
      const apart = total(state) + (f.count - 1) * total(state, f.bodies);
      return (built) => same(total(built), apart);
    },
  },
};

function refused(error: unknown): boolean {
  return (
    error instanceof NoCorner ||
    (error instanceof Error &&
      error.cause !== undefined &&
      refused(error.cause))
  );
}

export async function sizeLimit(
  state: EvalState,
  doc: CadDocument,
  position: number | undefined,
  feature: SizedFeature,
  resume: () => Promise<EvalState> = async () => state,
): Promise<SizeLimit> {
  const bound: Bound<SizedFeature> = BOUNDS[feature.type];
  const key = SIZE_KEYS[feature.type];
  const sign = Reflect.get(feature, key) < 0 ? -1 : 1;
  const toSize = (step: number) => (bound.least ? 1 / step : step);
  const earlier = doc.features.slice(0, position ?? doc.timelinePosition);
  let deadline = performance.now() + TIMING_MS.sizeLimitSearch;
  const late = () => performance.now() > deadline;
  let step = toSize(bound.estimate(state, feature));
  if (!(step > 0 && step < Infinity))
    throw new ValidationError("no size to try for these picks");
  const passes = bound.passes?.(state, feature) ?? (() => true);
  const shaped = bound.trial?.(feature) ?? feature;
  const build = (at: number) =>
    trialBuild(
      state,
      { ...shaped, [key]: sign * toSize(at) },
      earlier,
      doc.namingVersion,
      late,
      passes,
    );
  let fit = 0;
  let fail = Infinity;
  let builds = 0;
  while (builds < TRIAL_BUDGET.sizeLimitBuilds && !late()) {
    if (builds > 0) {
      const paused = performance.now();
      state = await resume();
      deadline += performance.now() - paused;
    }
    builds++;
    let passed = false;
    try {
      passed = build(step);
    } catch (error) {
      if (late()) break;
      if (refused(error)) return { kind: "smooth", builds };
      if (error instanceof Untouched) return { kind: "untouched", builds };
    }
    if (passed) fit = step;
    else fail = step;
    if (fail / fit <= CLOSE_ENOUGH) break;
    if (fit === 0) step = fail / STEP;
    else if (fail === Infinity) step = fit * STEP;
    else step = Math.sqrt(fit * fail);
  }
  if (fit > 0 && fail / fit > CLOSE_ENOUGH)
    return { kind: "stopped", size: toSize(fit), builds };
  if (fit > 0) return { kind: "upTo", size: toSize(fit), builds };
  if (fail === Infinity) return { kind: "slow", builds };
  return { kind: "stopped", below: toSize(fail), builds };
}
