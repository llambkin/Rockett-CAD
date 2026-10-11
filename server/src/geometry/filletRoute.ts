import {
  LINEAR_TOL,
  type EdgeRef,
  type FilletFeature,
  type Vec3,
} from "@rockett/shared";
import { planeSides } from "./blendSides.js";
import { measuredFace } from "./chamferContour.js";
import { conicStrip } from "./conicStrip.js";
import { cylinderFillet } from "./cylinderFillet.js";
import { ellipticStrip, type MeasuredEdge } from "./ellipticStrip.js";
import { NoCorner, vertexPoint, type ToolResult } from "./featureState.js";
import { V } from "./frames.js";
import {
  edges,
  faces,
  getKernel,
  planarFacePlane,
  scoped,
  vertices,
  type Own,
  type Shape,
} from "./kernel.js";
import type { NamedBody } from "./naming.js";
import { planarBlend, planarFillet } from "./planarFillet.js";

export const TWO_DISTANCE_FACES =
  "two-distance fillet works on straight edges between flat faces";
export const CHANGING_CHAIN =
  "two-distance fillet cannot yet run along collinear edges: pick edges that end at corners";

type Selected = { edge: Shape; name: string }[];

function line(edge: Shape, own: Own): [Vec3, Vec3] {
  const [a, b] = vertices(edge).map(own).map(vertexPoint);
  return [a!, b!];
}

function collinear(a: [Vec3, Vec3], b: [Vec3, Vec3]) {
  const axis = V.normalize(V.sub(a[1], a[0]));
  return b.every((point) => {
    const offset = V.sub(point, a[0]);
    return (
      V.norm(V.sub(offset, V.scale(axis, V.dot(offset, axis)))) <= LINEAR_TOL
    );
  });
}

function continues(edge: Shape, all: Shape[], own: Own) {
  const k = getKernel();
  const ends = vertices(edge).map(own);
  return all.some(
    (other) =>
      !other.IsSame(edge) &&
      own(new k.BRepAdaptor_Curve_2(other)).GetType() ===
        k.GeomAbs_CurveType.GeomAbs_Line &&
      vertices(other)
        .map(own)
        .some((vertex) => ends.some((end) => end.IsSame(vertex))) &&
      collinear(line(edge, own), line(other, own)),
  );
}

function unsupported(
  body: NamedBody,
  selected: Selected,
  own: Own,
  meeting: number,
) {
  const original = faces(body.shape).map(own);
  const ends = selected.flatMap(({ edge }) => vertices(edge).map(own));
  const touching = original.filter((face) =>
    vertices(face)
      .map(own)
      .some((vertex) => ends.some((end) => end.IsSame(vertex))),
  );
  if (
    selected.some(({ edge }) => !planeSides(edge, original, own)) ||
    touching.some((face) => !planarFacePlane(face))
  )
    return TWO_DISTANCE_FACES;
  const all = edges(body.shape).map(own);
  if (selected.some(({ edge }) => continues(edge, all, own)))
    return CHANGING_CHAIN;
  if (ends.some((end) => ends.filter((v) => v.IsSame(end)).length > meeting))
    return "two-distance fillet cannot round a corner where three edges meet: pick fewer edges or use equal distances";
  return null;
}

function measuredEdges(
  body: NamedBody,
  selected: Selected,
  f: FilletFeature,
  own: Own,
): MeasuredEdge[] {
  const measured: (MeasuredEdge & { line: [Vec3, Vec3] })[] = [];
  for (const { edge } of selected) {
    const points = line(edge, own);
    const mid = V.scale(V.add(points[0], points[1]), 0.5);
    const chained = measured.find((m) => collinear(m.line, points));
    const normal =
      chained?.normal ??
      planarFacePlane(own(measuredFace(body, edge, selected, f)))!.normal;
    measured.push({ mid, normal, line: points });
  }
  return measured;
}

function twoDistanceFillet(
  body: NamedBody,
  selected: Selected,
  f: FilletFeature,
  distances: [number, number],
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult {
  const measured = scoped((own) => {
    const reason = unsupported(body, selected, own, 2);
    if (reason) throw new Error(reason);
    return measuredEdges(body, selected, f, own);
  });
  const failure = `could not build a ${distances[0]} by ${distances[1]} mm two-distance fillet: try smaller distances or fewer edges`;
  try {
    const result = planarBlend(
      body,
      selected,
      ellipticStrip(distances, measured),
      f.id,
      byName,
      refs,
    );
    if (result) return result;
  } catch (error) {
    if (error instanceof NoCorner) throw error;
    throw new Error(failure, { cause: error });
  }
  throw new Error(failure);
}

function conicFillet(
  body: NamedBody,
  selected: Selected,
  f: FilletFeature,
  radii: [number, number],
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult | null {
  const k = getKernel();
  const starts = scoped((own) =>
    unsupported(body, selected, own, 1)
      ? null
      : selected.map(({ edge }) =>
          vertexPoint(own(k.TopExp.FirstVertex(edge, false))),
        ),
  );
  return (
    starts &&
    planarBlend(body, selected, conicStrip(radii, starts), f.id, byName, refs)
  );
}

export function moduleFillet(
  body: NamedBody,
  selected: Selected,
  f: FilletFeature,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult | null {
  if (f.filletType === "variableRadius")
    return f.endRadius === undefined ||
      Math.abs(f.endRadius - f.radius) <= LINEAR_TOL
      ? null
      : conicFillet(body, selected, f, [f.radius, f.endRadius], byName, refs);
  const second = f.filletType === "twoDistances" ? f.distance2 : undefined;
  if (second !== undefined && Math.abs(second - f.radius) > LINEAR_TOL)
    return twoDistanceFillet(
      body,
      selected,
      f,
      [f.radius, second],
      byName,
      refs,
    );
  return (
    planarFillet(body, selected, f.radius, f.id, byName, refs) ??
    cylinderFillet(body, selected, f.radius, f.id, byName, refs)
  );
}
