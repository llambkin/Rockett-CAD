import {
  newId,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchOffset,
} from "./model.js";
import {
  constraintEntityRefs,
  offsetSketchSelection,
  offsetSourceIds,
} from "./sketchModify.js";
import { solveSketch, type SolveInput, type SolveResult } from "./solver.js";

export function createSketchOffset(
  sketch: SketchFeature,
  ids: string[],
  distance: number,
  autoChain = true,
  joinTolerance = 0.01,
): SketchFeature {
  const sourceIds = offsetSourceIds(sketch.entities, ids, autoChain);
  const result = offsetSketchSelection(
    sketch.entities,
    sketch.constraints,
    sourceIds,
    distance,
    false,
    joinTolerance,
  );
  const oldIds = new Set(sketch.entities.map((e) => e.id));
  const offset: SketchOffset = {
    id: newId("offset"),
    distance,
    sourceIds,
    joinTolerance,
    entityIds: result.entities
      .filter((e) => !oldIds.has(e.id))
      .map((e) => e.id),
  };
  // Derived geometry is edited through its distance, not free point dragging.
  return {
    ...sketch,
    entities: result.entities.map((e) =>
      oldIds.has(e.id) ? e : { ...e, external: true },
    ),
    offsets: [...(sketch.offsets ?? []), offset],
  };
}

function existingOf(entities: SketchEntity[], offset: SketchOffset) {
  const existing = offset.entityIds.map((entityId) =>
    entities.find((e) => e.id === entityId),
  );
  if (existing.some((e) => !e))
    throw new Error(
      "Offset geometry was deleted or trimmed. Recreate this offset to edit its distance.",
    );
  return existing as SketchEntity[];
}

function rebuildOffset(
  entities: SketchEntity[],
  offset: SketchOffset,
  amount: number,
): SketchEntity[] {
  const existing = existingOf(entities, offset);
  const owned = new Set(offset.entityIds);
  const base = entities.filter((e) => !owned.has(e.id));
  const result = offsetSketchSelection(
    base,
    [],
    offset.sourceIds,
    amount,
    false,
    offset.joinTolerance,
  );
  const baseIds = new Set(base.map((e) => e.id));
  const added = result.entities.filter((e) => !baseIds.has(e.id));
  if (
    added.length !== existing.length ||
    added.some((e, j) => e.kind !== existing[j]!.kind)
  )
    throw new Error(
      "Offset topology changed. Recreate the offset for this source geometry.",
    );
  const ids = new Map(added.map((e, j) => [e.id, offset.entityIds[j]]));
  const replacements = new Map(
    added.map((e, j) => {
      const next = {
        ...e,
        id: ids.get(e.id)!,
        construction: existing[j]!.construction,
        external: existing[j]!.external,
      } as SketchEntity;
      if (next.kind === "line") {
        next.p1 = ids.get(next.p1)!;
        next.p2 = ids.get(next.p2)!;
      }
      if (next.kind === "circle" || next.kind === "arc")
        next.center = ids.get(next.center)!;
      if (next.kind === "arc") {
        next.start = ids.get(next.start)!;
        next.end = ids.get(next.end)!;
      }
      return [next.id, next] as const;
    }),
  );
  return entities.map((e) => replacements.get(e.id) ?? e);
}

function mismatch(a: SketchEntity[], b: SketchEntity[], ids: string[]) {
  const at = new Map(b.map((e) => [e.id, e]));
  return ids.reduce((sum, id) => {
    const p = a.find((e) => e.id === id),
      q = at.get(id);
    if (p?.kind === "point" && q?.kind === "point")
      return sum + (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (p?.kind === "circle" && q?.kind === "circle")
      return sum + (p.radius - q.radius) ** 2;
    return sum;
  }, 0);
}

function sideOf(entities: SketchEntity[], offset: SketchOffset): 1 | -1 {
  existingOf(entities, offset);
  const stored = offset.distance < 0 ? -1 : 1;
  let best: { side: 1 | -1; error: number } | null = null;
  let failure: unknown;
  for (const side of [stored, -stored] as (1 | -1)[]) {
    try {
      const rebuilt = rebuildOffset(
        entities,
        offset,
        side * Math.abs(offset.distance),
      );
      const error = mismatch(entities, rebuilt, offset.entityIds);
      if (!best || error < best.error) best = { side, error };
    } catch (e) {
      failure ??= e;
    }
  }
  if (!best) throw failure;
  return best.side;
}

/** Rebuild an offset while retaining entity IDs used by profiles and features. */
export function editSketchOffset(
  sketch: SketchFeature,
  id: string,
  distance: number,
): SketchFeature {
  const offsets = sketch.offsets ?? [];
  const start = offsets.findIndex((o) => o.id === id);
  if (start < 0) throw new Error("This offset is no longer available.");
  const sides = offsets.map((o, i) =>
    i < start ? 1 : sideOf(sketch.entities, o),
  );
  const sameSign = Math.sign(distance) === Math.sign(offsets[start]!.distance);
  let entities = sketch.entities;
  const updated = offsets.map((o) => (o.id === id ? { ...o, distance } : o));
  for (let i = start; i < updated.length; i++) {
    const side = i === start && !sameSign ? -sides[i]! : sides[i]!;
    entities = rebuildOffset(
      entities,
      updated[i]!,
      side * Math.abs(updated[i]!.distance),
    );
  }
  return { ...sketch, entities, offsets: updated };
}

export function followSketchOffsets(
  before: SketchEntity[],
  after: SketchEntity[],
  offsets: SketchOffset[],
): { entities: SketchEntity[]; failures: string[] } {
  const failures: string[] = [];
  let entities = after;
  for (const offset of offsets) {
    const present = (list: SketchEntity[]) =>
      offset.entityIds.every((id) => list.some((e) => e.id === id));
    if (!present(before) || !present(entities)) continue;
    try {
      entities = rebuildOffset(
        entities,
        offset,
        sideOf(before, offset) * Math.abs(offset.distance),
      );
    } catch (e) {
      failures.push((e as Error).message);
    }
  }
  return { entities, failures };
}

export function solveWithOffsets(
  input: SolveInput & { offsets?: SketchOffset[] | undefined },
  before: SketchEntity[],
): {
  solved: SolveResult;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  removedConstraints: number;
  failures: string[];
} {
  const { offsets = [], ...rest } = input;
  if (!offsets.length) {
    const solved = solveSketch(rest);
    return {
      solved,
      entities: input.entities,
      constraints: input.constraints,
      removedConstraints: 0,
      failures: [],
    };
  }
  const owned = new Set(offsets.flatMap((o) => o.entityIds));
  const refs = new Map(
    input.constraints.map((c) => [c, constraintEntityRefs(c)]),
  );
  const touches = (c: SketchConstraint) =>
    refs.get(c)!.some((id) => owned.has(id));
  const source = solveSketch({
    ...rest,
    constraints: input.constraints.filter((c) => !touches(c)),
  });
  const followed = followSketchOffsets(
    before,
    source.converged ? source.entities : input.entities,
    offsets,
  );
  const broken = new Set(
    input.constraints.filter(
      (c) =>
        refs.get(c)!.length > 0 &&
        refs.get(c)!.every((id) => owned.has(id)) &&
        !solveSketch({ entities: followed.entities, constraints: [c] })
          .converged,
    ),
  );
  const constraints = input.constraints.filter((c) => !broken.has(c));
  return {
    solved: solveSketch({ ...rest, entities: followed.entities, constraints }),
    entities: followed.entities,
    constraints,
    removedConstraints: broken.size,
    failures: followed.failures,
  };
}

/** Place the edit badge on the first offset curve. */
export function sketchOffsetAnchor(
  sketch: SketchFeature,
  offset: SketchOffset,
): { x: number; y: number } | null {
  const curve = offset.entityIds
    .map((id) => sketch.entities.find((e) => e.id === id))
    .find((e) => e && e.kind !== "point");
  const point = (id: string) =>
    sketch.entities.find((e) => e.id === id && e.kind === "point") as
      Extract<SketchEntity, { kind: "point" }> | undefined;
  if (curve?.kind === "line") {
    const a = point(curve.p1),
      b = point(curve.p2);
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }
  if (curve?.kind === "circle") {
    const c = point(curve.center);
    return c ? { x: c.x + curve.radius, y: c.y } : null;
  }
  if (curve?.kind === "arc") return point(curve.start) ?? null;
  return null;
}
