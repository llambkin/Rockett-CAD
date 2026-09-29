import {
  ValidationError,
  type CadDocument,
  type EdgeRef,
  type SizeLimit,
  type SizedFeature,
} from "@rockett/shared";
import { TIMING_MS, TRIAL_BUDGET } from "../tunables.js";
import { trialBuild } from "./engine.js";
import { NoCorner, type EvalState } from "./features.js";
import {
  areaOf,
  getKernel,
  lengthOf,
  listToArray,
  release,
  volumeOf,
} from "./kernel.js";
import { computeEdgeNames } from "./naming.js";

const SIZE = { fillet: "radius", chamfer: "distance", shell: "thickness" };
const CLOSE_ENOUGH = 1.25;
const STEP = 4;

function edgeRoom(state: EvalState, refs: EdgeRef[]): number {
  const k = getKernel();
  let room = Infinity;
  for (const ref of refs) {
    const body = state.bodies.get(ref.bodyId);
    if (!body) throw new ValidationError(`body ${ref.bodyId} not found`);
    const byName = computeEdgeNames(body).byName;
    const map = new k.TopTools_IndexedDataMapOfShapeListOfShape_1();
    try {
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
      release(faces);
    } finally {
      map.delete();
      release(byName.values());
    }
  }
  return room;
}

function estimate(state: EvalState, feature: SizedFeature): number {
  if (feature.type !== "shell") return edgeRoom(state, feature.edges);
  const bodyId = feature.openFaces[0]?.bodyId ?? [...state.bodies.keys()][0];
  const body = bodyId === undefined ? undefined : state.bodies.get(bodyId);
  if (!body) throw new ValidationError("no body to shell");
  return (3 * volumeOf(body.shape)) / areaOf(body.shape);
}

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
  const earlier = doc.features.slice(0, position ?? doc.timelinePosition);
  let deadline = performance.now() + TIMING_MS.sizeLimitSearch;
  const late = () => performance.now() > deadline;
  const build = (size: number) =>
    trialBuild(
      state,
      { ...feature, [SIZE[feature.type]]: size },
      earlier,
      doc.namingVersion,
      late,
      () => undefined,
    );
  let fit = 0;
  let fail = Infinity;
  let builds = 0;
  let size = estimate(state, feature);
  if (!(size > 0 && size < Infinity))
    throw new ValidationError("no size to try for these picks");
  while (builds < TRIAL_BUDGET.sizeLimitBuilds && !late()) {
    if (builds > 0) {
      const paused = performance.now();
      state = await resume();
      deadline += performance.now() - paused;
    }
    builds++;
    try {
      build(size);
      fit = size;
    } catch (error) {
      if (late()) break;
      if (refused(error)) return { kind: "smooth", builds };
      fail = size;
    }
    if (fail / fit <= CLOSE_ENOUGH) break;
    if (fit === 0) size = fail / STEP;
    else if (fail === Infinity) size = fit * STEP;
    else size = Math.sqrt(fit * fail);
  }
  if (fit > 0 && fail / fit > CLOSE_ENOUGH && late())
    return { kind: "stopped", size: fit, builds };
  if (fit > 0) return { kind: "upTo", size: fit, builds };
  if (fail === Infinity) return { kind: "slow", builds };
  if (late()) return { kind: "stopped", below: fail, builds };
  return { kind: "none", below: fail, builds };
}
