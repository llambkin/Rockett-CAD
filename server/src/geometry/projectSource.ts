import {
  constraintEntityRefs,
  groupRoot,
  isGroupRef,
  projectEdge,
  seenEdgeOn,
  sketchSpaceCurve,
  type ExactCurve,
  type GroupRef,
  type PlaneFrame,
  type ProjectionRef,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from "@rockett/shared";
import type { EvalState } from "./featureState.js";
import { computeEdgeNames, findFace, type NamedBody } from "./naming.js";
import { exactCurve } from "./edgeCurve.js";
import { release, scoped } from "./kernel.js";
import { bodyOutline, faceEdges, type OutlinePiece } from "./bodyOutline.js";
import { bodySection, SectionMiss } from "./bodySection.js";

const EDGE_ON_FACE =
  "This face is seen edge-on from the sketch plane. Choose a face visible in the sketch plane.";

export const sourceNoun = (ref: ProjectionRef): string =>
  ref.kind === "section"
    ? sourceNoun(ref.of)
    : ref.kind === "sketchEntity"
      ? "sketch entity"
      : ref.kind;

function sourceLabel(ref: ProjectionRef): string {
  if (ref.kind === "section") return `section of ${sourceLabel(ref.of)}`;
  if (ref.kind === "edge") return `edge ${ref.edgeName}`;
  if (ref.kind === "face") return `face ${ref.faceName}`;
  if (ref.kind === "body") return `body ${ref.bodyId}`;
  return `sketch entity ${ref.entityId} of ${ref.sketchId}`;
}

function sourceCurve(
  state: EvalState,
  ref: Exclude<ProjectionRef, GroupRef>,
): ExactCurve | undefined {
  if (ref.kind === "sketchEntity") {
    const sketch = state.sketches.get(ref.sketchId);
    return sketch && sketchSpaceCurve(sketch, ref.entityId);
  }
  const body = state.bodies.get(ref.bodyId);
  const byName = body && computeEdgeNames(body).byName;
  try {
    const edge = byName?.get(ref.edgeName);
    return edge && exactCurve(edge);
  } finally {
    release(byName?.values() ?? []);
  }
}

function faceCurves(
  body: NamedBody,
  faceName: string,
): OutlinePiece[] | undefined {
  return scoped(() => {
    const face = findFace(body, faceName);
    return face
      ? faceEdges(face, [...computeEdgeNames(body).byName])
      : undefined;
  });
}

function groupPieces(
  state: EvalState,
  ref: GroupRef,
  frame: PlaneFrame,
): OutlinePiece[] | undefined {
  const body = state.bodies.get(
    ref.kind === "section" ? ref.of.bodyId : ref.bodyId,
  );
  if (!body) return undefined;
  if (ref.kind === "section") return bodySection(body, frame, ref.of);
  return ref.kind === "face"
    ? faceCurves(body, ref.faceName)
    : bodyOutline(body, frame, ref);
}

export function projectSource(
  state: EvalState,
  ref: ProjectionRef,
  frame: PlaneFrame,
  id: string,
  construction = true,
): SketchEntity[] | undefined {
  if (!isGroupRef(ref)) {
    const curve = sourceCurve(state, ref);
    return curve && projectEdge(curve, frame, id, ref, construction);
  }
  const pieces = groupPieces(state, ref, frame);
  if (pieces?.length === 0)
    throw new Error(`This ${ref.kind} has no edges to project.`);
  try {
    return pieces?.flatMap(({ key, curve }) =>
      projectEdge(curve, frame, `${id}:${key}`, ref, construction),
    );
  } catch (error) {
    if (ref.kind === "face" && seenEdgeOn(error))
      throw new Error(EDGE_ON_FACE, { cause: error });
    throw error;
  }
}

function sectioned(...args: Parameters<typeof projectSource>) {
  try {
    return projectSource(...args);
  } catch (error) {
    if (error instanceof SectionMiss) return error;
    throw error;
  }
}

const place = (e: SketchEntity) =>
  JSON.stringify(
    e.kind === "point" ? [e.x, e.y] : e.kind === "circle" ? e.radius : e.kind,
  );

export function refreshProjections(
  state: EvalState,
  f: SketchFeature,
  frame: PlaneFrame,
) {
  const stored = new Map(f.entities.map((e) => [e.id, e]));
  const placed = new Map(f.entities.map((e) => [e.id, place(e)]));
  const roots = new Set<string>();
  const empty: string[] = [];
  let entities = f.entities.map((e) => ({ ...e }));
  let moved = false;
  for (const entity of f.entities) {
    if (entity.kind === "point" || !entity.projection) continue;
    const ref = entity.projection;
    const group = isGroupRef(ref);
    const id = group ? groupRoot(entity.id) : entity.id;
    if (roots.has(id)) continue;
    roots.add(id);
    const result = sectioned(state, ref, frame, id, entity.construction);
    if (result instanceof SectionMiss)
      empty.push(
        `Section ${id} is empty: the sketch plane ${result.verb} ${sourceLabel(result.of)}.`,
      );
    const projected = result instanceof SectionMiss ? [] : result;
    if (!projected)
      throw new Error(
        `Projected ${sourceLabel(ref)} is missing. Restore its source or delete and re-project the reference.`,
      );
    if (projected.some((e) => (stored.get(e.id)?.kind ?? e.kind) !== e.kind))
      throw new Error(
        `Projected ${sourceLabel(ref)} changed curve type. Re-project this reference.`,
      );
    moved ||= projected.some((e) => placed.get(e.id) !== place(e));
    if (!group) {
      const replacements = new Map(projected.map((e) => [e.id, e]));
      entities = entities.map((e) => replacements.get(e.id) ?? e);
      for (const e of projected)
        if (!entities.some((old) => old.id === e.id)) entities.push(e);
      continue;
    }
    const inGroup = (e: SketchEntity) => e.id.startsWith(`${id}:`);
    const members = projected.map((e) => {
      const was = stored.get(e.id);
      return e.kind === "point" || !was
        ? e
        : Object.assign(e, { construction: was.construction === true });
    });
    const at = entities.findIndex(inGroup);
    moved ||= entities.filter(inGroup).length !== members.length;
    entities = [
      ...entities.slice(0, at),
      ...members,
      ...entities.slice(at).filter((e) => !inGroup(e)),
    ];
  }
  const ids = new Set(entities.map((e) => e.id));
  const gone = (c: SketchConstraint) =>
    constraintEntityRefs(c).find((r) => !ids.has(r) && roots.has(groupRoot(r)));
  const lost = f.constraints
    .flatMap((c) => {
      const curve = gone(c)?.split(":").slice(0, 2).join(":");
      return curve
        ? [
            `Relation ${c.id} lost its projected curve ${curve}; re-attach or delete it.`,
          ]
        : [];
    })
    .concat(empty)
    .join(" ");
  const constraints = f.constraints.filter((c) => !gone(c));
  return { entities, constraints, moved, lost };
}
