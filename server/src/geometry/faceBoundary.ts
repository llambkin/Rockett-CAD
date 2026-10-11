import assert from "node:assert/strict";
import {
  edges,
  vertices,
  wires,
  getKernel,
  shapeList,
  planarFacePlane,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";
import { originalCarrierMetric } from "./originalCarrierMetric.js";

type BoundaryEdit = { edge: Shape; replacement: Shape[] };

function orderedBoundary(boundary: Shape[], own: Own) {
  const remaining = [...boundary];
  const curves = nativeBoundaryCurves(own);
  const first = remaining[0];
  assert(first);
  const start = curves.beginning(first);
  remaining.shift();
  let current = curves.ending(first);
  const ordered: Shape[] = [first];
  while (remaining.length) {
    const choices = remaining.filter(
      (edge) =>
        curves.beginning(edge).IsSame(current) ||
        curves.ending(edge).IsSame(current),
    );
    const stationary = choices.filter(
      (edge) =>
        getKernel().BRep_Tool.Degenerated(edge) &&
        curves.beginning(edge).IsSame(current) &&
        curves.ending(edge).IsSame(current),
    );
    assert(stationary.length <= 1);
    assert(stationary.length || choices.length === 1);
    const edge = stationary[0] ?? choices[0]!;
    remaining.splice(remaining.indexOf(edge), 1);
    const oriented = curves.orient(edge, current);
    ordered.push(oriented);
    current = curves.ending(oriented);
  }
  assert(current.IsSame(start));
  return ordered;
}

function interiorContacts(old: Shape, contacts: Shape[], own: Own) {
  const k = getKernel(),
    curves = nativeBoundaryCurves(own);
  const curve = own(new k.BRepAdaptor_Curve_2(old));
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) return [];
  const start = curves.beginning(old),
    end = curves.ending(old);
  const origin = vertexPoint(start),
    axis = V.sub(vertexPoint(end), origin);
  const length2 = V.dot(axis, axis);
  assert(length2 > 0);
  const distance = originalCarrierMetric(old, own);
  return contacts
    .filter((v) => !v.IsSame(start) && !v.IsSame(end))
    .map((vertex) => ({
      vertex,
      t: V.dot(V.sub(vertexPoint(vertex), origin), axis) / length2,
    }))
    .filter(
      ({ vertex, t }) =>
        t > 0 &&
        t < 1 &&
        distance(vertex) <=
          k.BRep_Tool.Tolerance_2(old) + k.BRep_Tool.Tolerance_3(vertex),
    )
    .toSorted((a, b) => a.t - b.t);
}

function boundaryVertices(boundary: Shape[], own: Own) {
  return boundary
    .flatMap((edge) => vertices(edge).map(own))
    .filter((v, i, all) => all.findIndex((other) => other.IsSame(v)) === i);
}

function nodeContacts(
  boundary: Shape[],
  source: Shape,
  own: Own,
  pool = boundary,
) {
  const curves = nativeBoundaryCurves(own);
  const contacts = boundaryVertices(pool, own);
  return boundary.flatMap((old) => {
    const interior = interiorContacts(old, contacts, own);
    if (!interior.length) return [old];
    assert(interior.every((entry, i) => !i || entry.t > interior[i - 1]!.t));
    const points = [
      curves.beginning(old),
      ...interior.map((entry) => entry.vertex),
      curves.ending(old),
    ];
    return points.slice(1).map((end, i) => {
      const edge = curves.carrierEdge(old, points[i]!, end);
      if (!planarFacePlane(source)) curves.transfer(old, edge, source);
      return edge;
    });
  });
}

type Traced = {
  wire: Shape;
  outer: boolean;
  changed: boolean;
  boundary: Shape[];
};

function touches(a: Traced, b: Traced, own: Own) {
  const points = boundaryVertices(b.boundary, own);
  return a.boundary.some(
    (edge) =>
      vertices(edge)
        .map(own)
        .some((v) => points.some((p) => p.IsSame(v))) ||
      interiorContacts(edge, points, own).length > 0,
  );
}

function touchingWires(traced: Traced[], own: Own) {
  let groups: Traced[][] = [];
  for (const entry of traced) {
    const joined = groups.filter((group) =>
      group.some(
        (other) =>
          (entry.changed || other.changed) &&
          (touches(entry, other, own) || touches(other, entry, own)),
      ),
    );
    groups = groups.filter((group) => !joined.includes(group));
    groups.push([...joined.flat(), entry]);
  }
  return groups;
}

function cancels(a: Shape, b: Shape, own: Own) {
  const k = getKernel(),
    curves = nativeBoundaryCurves(own);
  const line = (edge: Shape) =>
    own(new k.BRepAdaptor_Curve_2(edge)).GetType() ===
    k.GeomAbs_CurveType.GeomAbs_Line;
  return (
    !a.IsSame(b) &&
    curves.beginning(a).IsSame(curves.ending(b)) &&
    curves.ending(a).IsSame(curves.beginning(b)) &&
    line(a) &&
    line(b)
  );
}

function pooledCycles(group: Traced[], source: Shape, own: Own) {
  const pool = group.flatMap((entry) => entry.boundary);
  const pieces = group.flatMap(({ outer, boundary }) =>
    nodeContacts(boundary, source, own, pool).map((edge) => ({
      edge,
      outer,
    })),
  );
  const kept = pieces.filter(
    (piece) => !pieces.some((other) => cancels(piece.edge, other.edge, own)),
  );
  return boundaryCycles(
    kept.map((piece) => piece.edge),
    own,
  ).map((cycle) => ({
    outer: cycle.some((edge) =>
      kept.some((piece) => piece.outer && piece.edge.IsSame(edge)),
    ),
    cycles: [makeWire(cycle, own)],
  }));
}

function closedCycles(boundary: Shape[], own: Own) {
  const curves = nativeBoundaryCurves(own),
    first = boundary[0];
  assert(first);
  let path: Shape[] = [],
    points = [{ vertex: curves.beginning(first), offset: 0 }];
  const cycles: Shape[][] = [];
  for (const edge of boundary) {
    assert(curves.beginning(edge).IsSame(points.at(-1)!.vertex));
    path.push(edge);
    const finish = curves.ending(edge);
    if (
      getKernel().BRep_Tool.Degenerated(edge) &&
      finish.IsSame(curves.beginning(edge))
    )
      continue;
    const previous = points.findIndex((point) => point.vertex.IsSame(finish));
    if (previous < 0) points.push({ vertex: finish, offset: path.length });
    else {
      cycles.push(path.splice(points[previous]!.offset));
      points = points.slice(0, previous + 1);
    }
  }
  assert.equal(path.length, 0);
  assert.equal(cycles.flat().length, boundary.length);
  return cycles;
}

function boundaryCycles(boundary: Shape[], own: Own) {
  const curves = nativeBoundaryCurves(own),
    remaining = [...boundary];
  const cycles: Shape[][] = [];
  while (remaining.length) {
    const first =
      remaining.find((edge) => !getKernel().BRep_Tool.Degenerated(edge)) ??
      remaining[0]!;
    remaining.splice(remaining.indexOf(first), 1);
    const start = curves.beginning(first);
    let current = curves.ending(first);
    const ordered = [first];
    const stationary = (edge: Shape) =>
      getKernel().BRep_Tool.Degenerated(edge) &&
      curves.beginning(edge).IsSame(current) &&
      curves.ending(edge).IsSame(current);
    while (!current.IsSame(start) || remaining.some(stationary)) {
      const choices = remaining.filter(
        (edge) =>
          curves.beginning(edge).IsSame(current) ||
          curves.ending(edge).IsSame(current),
      );
      assert(choices.length > 0);
      const collapsed = choices.filter(stationary);
      assert(collapsed.length <= 1);
      const next = collapsed[0] ?? remaining[0];
      const chosen =
        next && choices.includes(next)
          ? next
          : choices.length === 1
            ? choices[0]!
            : null;
      assert(chosen);
      remaining.splice(remaining.indexOf(chosen), 1);
      const edge = curves.orient(chosen, current);
      ordered.push(edge);
      current = curves.ending(edge);
    }
    cycles.push(...closedCycles(ordered, own));
  }
  assert.equal(cycles.flat().length, boundary.length);
  return cycles;
}

function makeWire(boundary: Shape[], own: Own) {
  const k = getKernel(),
    make = own(new k.BRepBuilderAPI_MakeWire_1());
  make.Add_3(own(shapeList(boundary)));
  if (!make.IsDone()) throw new Error("the planar boundary does not join");
  const result = own(make.Wire()),
    members = edges(result).map(own);
  if (
    members.length !== boundary.length ||
    boundary.some((edge) => !members.some((part) => part.IsSame(edge)))
  )
    throw new Error("the planar boundary lost an edge");
  return result;
}

function makeFace(source: Shape, boundary: Shape[], own: Own) {
  const k = getKernel(),
    face = own(k.TopoDS.Face_1(own(source.EmptyCopied()))),
    builder = own(new k.BRep_Builder());
  for (const wire of boundary) builder.Add(face, wire);
  builder.NaturalRestriction(face, false);
  k.BRepLib.SameParameter_3(face, k.BRep_Tool.Tolerance_1(face), true);
  return face;
}

export function planarFaceBoundary(
  source: Shape,
  edits: BoundaryEdit[],
  own: Own,
): Shape;
export function planarFaceBoundary(
  source: Shape,
  edits: BoundaryEdit[],
  own: Own,
  components: true,
): Shape[];
export function planarFaceBoundary(
  source: Shape,
  edits: BoundaryEdit[],
  own: Own,
  components = false,
): Shape | Shape[] {
  const k = getKernel(),
    used = new Set<BoundaryEdit>();
  const outer = own(k.BRepTools.OuterWire(source));
  const traced = wires(source)
    .map(own)
    .map((wire) => {
      let changed = false;
      const boundary = orderedBoundary(edges(wire).map(own), own).flatMap(
        (edge) => {
          const edit = edits.find((candidate) => candidate.edge.IsSame(edge));
          if (!edit) return [edge];
          if (used.has(edit)) throw new Error("the boundary edit is ambiguous");
          used.add(edit);
          changed = true;
          return edit.replacement;
        },
      );
      return { wire, outer: wire.IsSame(outer), changed, boundary };
    });
  const rebuilt = touchingWires(traced, own).flatMap((group) =>
    group.length > 1
      ? pooledCycles(group, source, own)
      : group.map((entry) => ({
          outer: entry.outer,
          cycles: entry.changed
            ? boundaryCycles(
                nodeContacts(entry.boundary, source, own),
                own,
              ).map((boundary) => makeWire(boundary, own))
            : [entry.wire],
        })),
  );
  if (used.size !== edits.length)
    throw new Error("the boundary edit has no original occurrence");
  const outside = rebuilt
    .filter((entry) => entry.outer)
    .flatMap((entry) => entry.cycles);
  assert(outside.length > 0);
  const holes = rebuilt
    .filter((entry) => !entry.outer)
    .flatMap((entry) => entry.cycles);
  const faces = outside.map((wire) => makeFace(source, [wire], own));
  for (const hole of holes) {
    const point = own(k.BRep_Tool.Pnt(vertices(hole).map(own)[0]!));
    const owners = faces.filter(
      (face) =>
        own(
          new k.BRepClass_FaceClassifier_4(
            face,
            point,
            k.BRep_Tool.Tolerance_1(source),
            false,
            0.1,
          ),
        ).State() === k.TopAbs_State.TopAbs_IN,
    );
    assert.equal(owners.length, 1);
    own(new k.BRep_Builder()).Add(owners[0], hole);
  }
  if (components) return faces;
  assert.equal(faces.length, 1);
  return faces[0]!;
}
