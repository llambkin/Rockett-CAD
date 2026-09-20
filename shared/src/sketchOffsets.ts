import { newId, type SketchEntity, type SketchFeature, type SketchOffset } from "./model.js";
import { offsetSketchSelection, offsetSourceIds } from "./sketchModify.js";

export function createSketchOffset(sketch: SketchFeature, ids: string[], distance: number,
  autoChain = true, joinTolerance = 0.01): SketchFeature {
  const sourceIds = offsetSourceIds(sketch.entities, ids, autoChain);
  const result = offsetSketchSelection(sketch.entities, sketch.constraints, sourceIds, distance, false, joinTolerance);
  const oldIds = new Set(sketch.entities.map(e => e.id));
  const offset: SketchOffset = { id: newId("offset"), distance, sourceIds, joinTolerance,
    entityIds: result.entities.filter(e => !oldIds.has(e.id)).map(e => e.id) };
  // Derived geometry is edited through its distance, not free point dragging.
  return { ...sketch, entities: result.entities.map(e => oldIds.has(e.id) ? e : { ...e, external: true }),
    offsets: [...(sketch.offsets ?? []), offset] };
}

/** Rebuild an offset while retaining entity IDs used by profiles and features. */
export function editSketchOffset(sketch: SketchFeature, id: string, distance: number): SketchFeature {
  const offsets = sketch.offsets ?? [];
  const start = offsets.findIndex(o => o.id === id);
  if (start < 0) throw new Error("This offset is no longer available.");
  let entities = sketch.entities;
  const updated = offsets.map(o => o.id === id ? { ...o, distance } : o);
  for (let i = start; i < updated.length; i++) {
    const offset = updated[i];
    const owned = new Set(offset.entityIds);
    const existing = offset.entityIds.map(entityId => entities.find(e => e.id === entityId));
    if (existing.some(e => !e)) throw new Error("Offset geometry was deleted or trimmed. Recreate this offset to edit its distance.");
    const base = entities.filter(e => !owned.has(e.id));
    const result = offsetSketchSelection(base, [], offset.sourceIds, offset.distance, false, offset.joinTolerance);
    const baseIds = new Set(base.map(e => e.id));
    const added = result.entities.filter(e => !baseIds.has(e.id));
    if (added.length !== existing.length || added.some((e, j) => e.kind !== existing[j]!.kind))
      throw new Error("Offset topology changed. Recreate the offset for this source geometry.");
    const ids = new Map(added.map((e, j) => [e.id, offset.entityIds[j]]));
    const replacements = new Map(added.map((e, j) => {
      const next = { ...e, id: ids.get(e.id)!, construction: existing[j]!.construction, external: existing[j]!.external } as SketchEntity;
      if (next.kind === "line") { next.p1 = ids.get(next.p1)!; next.p2 = ids.get(next.p2)!; }
      if (next.kind === "circle" || next.kind === "arc") next.center = ids.get(next.center)!;
      if (next.kind === "arc") { next.start = ids.get(next.start)!; next.end = ids.get(next.end)!; }
      return [next.id, next] as const;
    }));
    entities = entities.map(e => replacements.get(e.id) ?? e);
  }
  return { ...sketch, entities, offsets: updated };
}

/** Place the edit badge on the first offset curve. */
export function sketchOffsetAnchor(sketch: SketchFeature, offset: SketchOffset): { x: number; y: number } | null {
  const curve = offset.entityIds.map(id => sketch.entities.find(e => e.id === id)).find(e => e && e.kind !== "point");
  const point = (id: string) => sketch.entities.find(e => e.id === id && e.kind === "point") as Extract<SketchEntity, {kind: "point"}> | undefined;
  if (curve?.kind === "line") {
    const a = point(curve.p1), b = point(curve.p2);
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }
  if (curve?.kind === "circle") {
    const c = point(curve.center);
    return c ? { x: c.x + curve.radius, y: c.y } : null;
  }
  if (curve?.kind === "arc") return point(curve.start) ?? null;
  return null;
}
