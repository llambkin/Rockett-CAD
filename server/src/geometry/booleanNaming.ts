import { LINEAR_TOL, UNIT_DOT_TOL, type Vec3 } from "@rockett/shared";
import {
  bboxOf,
  faces as facesOf,
  getKernel,
  listToArray,
  release,
  scoped,
  lengthOf,
  type Shape,
} from "./kernel.js";
import { historyNames, propagateNames, type NamedBody } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { V } from "./frames.js";
import { bboxOverlap, zeroThicknessWarning } from "./joinCheck.js";
import type {
  EvalState,
  FeatureOutcome,
  StateBody,
  ToolResult,
} from "./featureState.js";

export type JoinResult = ToolResult & { warning?: string | undefined };

export function cylinderAxes(face: Shape): Vec3[] | null {
  const k = getKernel();
  return scoped((own) => {
    const surf = own(
      new k.BRepAdaptor_Surface_2(own(k.TopoDS.Face_1(face)), false),
    );
    if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Cylinder) return null;
    const frame = own(own(surf.Cylinder()).Position());
    return [own(frame.XDirection()), own(frame.YDirection())].map((d): Vec3 => [
      d.X(),
      d.Y(),
      d.Z(),
    ]);
  });
}

export function reparametrisedCylinderEdges(shape: Shape): Shape[] {
  const k = getKernel();
  const map = new k.TopTools_IndexedDataMapOfShapeListOfShape_1();
  k.TopExp.MapShapesAndAncestors(
    shape,
    k.TopAbs_ShapeEnum.TopAbs_EDGE,
    k.TopAbs_ShapeEnum.TopAbs_FACE,
    map,
  );
  const keep: Shape[] = [];
  for (let i = 1; i <= map.Extent(); i++) {
    const adjacent = listToArray(map.FindFromIndex_2(i));
    const [a, b] = adjacent.map(cylinderAxes);
    release(adjacent);
    if (a && b && a.some((d, j) => V.dot(d, b[j]!) < 1 - UNIT_DOT_TOL))
      keep.push(map.FindKey_2(i));
  }
  map.delete();
  return keep;
}

export function unifyTool(tool: ToolResult, featureId: string): ToolResult {
  const k = getKernel();
  try {
    const uni = new k.ShapeUpgrade_UnifySameDomain_2(
      tool.shape,
      true,
      true,
      false,
    );
    if (tool.names.version === 2) {
      const { min, max } = bboxOf(tool.shape);
      uni.SetLinearTolerance(LINEAR_TOL);
      uni.SetAngularTolerance(
        LINEAR_TOL / Math.max(1, V.norm(V.sub(max, min))),
      );
    }
    const seams = reparametrisedCylinderEdges(tool.shape);
    for (const edge of seams) uni.KeepShape(edge);
    release(seams);
    uni.Build();
    const merged = uni.Shape();
    const mergedFaces = facesOf(merged);
    release(mergedFaces);
    if (mergedFaces.length === 0) {
      release([merged, uni]);
      return tool;
    }
    const history = uni.History_1();
    const names = historyNames(history.get(), tool, merged, featureId);
    history.delete?.();
    uni.delete();
    return { shape: merged, names };
  } catch {
    return tool;
  }
}

export function finishJoin(
  fused: ToolResult,
  featureId: string,
  parts: { shape: Shape }[],
  unify = fused.names.version === 2,
): JoinResult {
  const joined = unify ? unifyTool(fused, featureId) : fused;
  const warning = zeroThicknessWarning(
    "join",
    joined.shape,
    parts.map((p) => p.shape),
  );
  return { ...joined, warning };
}

export function warned(
  warnings: (string | undefined)[],
): FeatureOutcome | undefined {
  const found = warnings.filter((w) => w !== undefined);
  return found.length > 0 ? { warning: found.join("; ") } : undefined;
}

export function namedFuse(
  op: any,
  a: ToolResult,
  b: ToolResult,
  featureId: string,
): ToolResult {
  try {
    const shape = op.Shape();
    return { shape, names: propagateNames(op, [a, b], shape, featureId) };
  } finally {
    op.delete();
  }
}

export function targetBody(
  state: EvalState,
  operation: string,
  id: string,
  tool: Shape,
): StateBody {
  const body = state.bodies.get(id);
  if (!body) throw new Error(`${operation} target ${id} no longer exists`);
  if (!bboxOverlap(body.shape, tool)) throw missedTarget(operation, id);
  return body;
}

export function missedTarget(operation: string, id: string): Error {
  return new Error(`${operation} target ${id} does not overlap the tool`);
}

export function overlapping(state: EvalState, tool: Shape): StateBody[] {
  return [...state.bodies.values()].filter(
    (b) => !state.hidden?.has(b.bodyId) && bboxOverlap(b.shape, tool),
  );
}

export function namedResult(
  op: any,
  parts: ToolResult[],
  featureId: string,
): ToolResult {
  const shape = op.Shape();
  const names = propagateNames(op, parts, shape, featureId);
  op.delete();
  return { shape, names };
}

export function keptSplitEdges(
  cut: any,
  sourceEdges: { edge: Shape }[],
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const k = getKernel();
  const kept = sourceEdges.map(({ edge }) => {
    const split = cut.IsDeleted(edge) ? [] : listToArray(cut.Modified(edge));
    const image = split.length === 1 ? own(k.TopoDS.Edge_1(split[0])) : edge;
    release(split);
    const whole = !cut.IsDeleted(edge) && split.length <= 1;
    return whole && Math.abs(lengthOf(image) - lengthOf(edge)) < LINEAR_TOL
      ? { edge: image }
      : null;
  });
  return kept.some((image) => !image) ? null : (kept as { edge: Shape }[]);
}

export function namedSplitPieces(
  cut: any,
  common: any,
  body: NamedBody,
  beyond: Shape,
  featureId: string,
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const blank = { shape: beyond, names: new ShapeMap<string>() };
  const [piece, rest] = [cut, common].map((op) => {
    const shape = own(op.Shape());
    return {
      bodyId: body.bodyId,
      shape,
      names: propagateNames(op, [body, blank], shape, featureId),
    };
  });

  return { piece: piece!, rest: rest! };
}
