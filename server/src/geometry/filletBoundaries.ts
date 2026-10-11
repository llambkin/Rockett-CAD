import { guideGraph, type Graph, type Patch } from "./filletGuideGraph.js";
import { originalCarrierMetric } from "./originalCarrierMetric.js";
import { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";
import assert from "node:assert/strict";
import {
  getKernel,
  edges,
  vertices,
  planarFacePlane,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import { planarFaceBoundary } from "./faceBoundary.js";

export type FilletEnd = {
  index: number;
  old: Shape;
  boundary: { edge: Shape; source: Shape | null }[];
  sourceEdits?: { face: Shape; edge: Shape; replacement: Shape[] }[];
  growth?: { edge: Shape; source: Shape; neighbor: Shape }[];
  termination?: {
    face: Shape;
    segments: {
      edge: Shape;
      contact: Shape;
      neighbor: Shape;
      carrier?: Shape;
      source: Shape | null;
    }[];
  };
};

type Curves = ReturnType<typeof nativeBoundaryCurves>;
type NativeContact = { face: Shape; old: Shape; edge: Shape | null };
type BoundaryEdit = { edge: Shape; replacement: Shape[] };

function mappedVertex(graph: Graph, vertex: Shape, face: Shape) {
  const candidates = graph.flatMap((p) =>
    p.neighbors
      .filter((n) => n.face.IsSame(face))
      .flatMap((n) =>
        n.contacts.filter((c) => c.old.IsSame(vertex)).map((c) => c.new),
      ),
  );
  if (!candidates.length) return null;
  assert(candidates.every((v) => v.IsSame(candidates[0])));
  const chosen = candidates[0];
  assert(chosen);
  return chosen;
}

function originalCarrierContact(
  old: Shape,
  vertex: Shape,
  graph: Graph,
  own: Own,
) {
  const k = getKernel();
  const contacts = graph.flatMap((patch) =>
    patch.endSeams
      .filter((end) => end.old.IsSame(vertex))
      .flatMap((end) =>
        end.boundary.flatMap(({ edge }) => vertices(edge).map(own)),
      ),
  );
  const unique = contacts.filter(
    (contact, index) =>
      contacts.findIndex((other) => other.IsSame(contact)) === index,
  );
  if (!unique.length) return vertex;
  const carrierDistance = originalCarrierMetric(old, own);
  const matches = unique.filter(
    (contact) =>
      carrierDistance(contact) <=
      k.BRep_Tool.Tolerance_2(old) + k.BRep_Tool.Tolerance_3(contact),
  );
  if (
    !matches.length &&
    graph.some((patch) =>
      patch.endSeams.some(
        (end) => end.old.IsSame(vertex) && (end.termination || end.growth),
      ),
    )
  )
    return vertex;
  assert.equal(matches.length, 1);
  return matches[0]!;
}

function changedBoundary(
  old: Shape,
  sourceFaces: Shape[],
  graph: Graph,
  curves: Curves,
  own: Own,
) {
  const k = getKernel();
  const { beginning, ending, carrierEdge, transfer } = curves;
  const replaceVertex = (vertex: Shape) =>
    originalCarrierContact(old, vertex, graph, own);
  const start = replaceVertex(beginning(old)),
    finish = replaceVertex(ending(old));
  if (start.IsSame(beginning(old)) && finish.IsSame(ending(old))) return null;
  const adjacent = sourceFaces.filter((f) =>
    edges(f)
      .map(own)
      .some((e) => e.IsSame(old)),
  );
  const oldStart = beginning(old),
    oldFinish = ending(old),
    axis = V.sub(vertexPoint(oldFinish), vertexPoint(oldStart));
  const line =
    own(new k.BRepAdaptor_Curve_2(old)).GetType() ===
    k.GeomAbs_CurveType.GeomAbs_Line;
  let replacement;
  if (
    line &&
    start.IsSame(oldStart) &&
    !finish.IsSame(oldFinish) &&
    V.dot(V.sub(vertexPoint(finish), vertexPoint(oldFinish)), axis) > 0
  )
    replacement = [old, carrierEdge(old, oldFinish, finish)];
  else if (
    line &&
    finish.IsSame(oldFinish) &&
    !start.IsSame(oldStart) &&
    V.dot(V.sub(vertexPoint(start), vertexPoint(oldStart)), axis) < 0
  )
    replacement = [carrierEdge(old, start, oldStart), old];
  else replacement = [carrierEdge(old, start, finish)];
  for (const edge of replacement)
    if (!edge.IsSame(old))
      for (const support of adjacent)
        if (!planarFacePlane(support)) transfer(old, edge, support);
  return replacement;
}

function attachCaps(
  face: Shape,
  edits: BoundaryEdit[],
  graph: Graph,
  curves: Curves,
  own: Own,
) {
  const { beginning, ending, orient } = curves;
  for (const patch of graph)
    for (const end of patch.endSeams)
      for (const part of end.boundary) {
        if (!part.source?.IsSame(face)) continue;
        const incident = edits.filter((edit) =>
          vertices(edit.edge)
            .map(own)
            .some((v) => v.IsSame(end.old)),
        );
        assert.equal(incident.length, end.growth ? 1 : 2);
        const ends = vertices(part.edge).map(own);
        const insertion = incident[0];
        assert(insertion);
        const first = insertion.replacement.find((edge) =>
          vertices(edge)
            .map(own)
            .some((v) => ends.some((e) => e.IsSame(v))),
        );
        assert(first);
        const attached = ends.find(
          (v) => beginning(first).IsSame(v) || ending(first).IsSame(v),
        );
        assert(attached);
        const seam = orient(part.edge, attached);
        insertion.replacement.push(seam);
        insertion.replacement.push(
          ...(end.growth ?? [])
            .filter((grown) => grown.source.IsSame(face))
            .map((grown) => grown.edge),
        );
      }
}

function attachTerminations(
  face: Shape,
  oldEdges: Shape[],
  edits: BoundaryEdit[],
  graph: Graph,
  curves: Curves,
  own: Own,
) {
  const { beginning, ending, orient } = curves;
  for (const patch of graph)
    for (const end of patch.endSeams) {
      if (!end.termination) continue;
      for (const segment of end.termination.segments) {
        if (segment.carrier && segment.source?.IsSame(face)) {
          const old = oldEdges.find((edge) => edge.IsSame(segment.carrier));
          assert(old);
          const edit = edits.find((e) => e.edge.IsSame(old));
          assert(edit);
          curves.transfer(old, segment.edge, face);
          if (beginning(old).IsSame(end.old))
            edit.replacement.unshift(orient(segment.edge, end.old));
          else {
            assert(ending(old).IsSame(end.old));
            edit.replacement.push(orient(segment.edge, segment.contact));
          }
        } else if (!segment.carrier && segment.neighbor.IsSame(face)) {
          const incident = oldEdges.filter(
            (edge) =>
              !edge.IsSame(patch.edge) &&
              vertices(edge)
                .map(own)
                .some((vertex) => vertex.IsSame(end.old)),
          );
          assert.equal(incident.length, 1);
          const old = incident[0]!;
          let edit = edits.find((e) => e.edge.IsSame(old));
          if (!edit) {
            edit = { edge: old, replacement: [old] };
            edits.push(edit);
          }
          if (ending(old).IsSame(end.old))
            edit.replacement.push(orient(segment.edge, end.old));
          else {
            assert(beginning(old).IsSame(end.old));
            edit.replacement.unshift(orient(segment.edge, segment.contact));
          }
        }
      }
    }
}

function attachSourceEdits(
  face: Shape,
  oldEdges: Shape[],
  edits: BoundaryEdit[],
  graph: Graph,
  own: Own,
) {
  const k = getKernel();
  for (const patch of graph)
    for (const end of patch.endSeams)
      for (const edit of end.sourceEdits ?? [])
        if (edit.face.IsSame(face)) {
          assert(!edits.some((existing) => existing.edge.IsSame(edit.edge)));
          const occurrence = oldEdges.find((edge) => edge.IsSame(edit.edge));
          assert(occurrence);
          const replacement =
            occurrence.Orientation_1() === edit.edge.Orientation_1()
              ? edit.replacement
              : edit.replacement
                  .toReversed()
                  .map((edge) => own(k.TopoDS.Edge_1(own(edge.Reversed()))));
          edits.push({ edge: occurrence, replacement });
        }
}

function guideReplacement(
  guide: Graph[number],
  face: Shape,
  start: Shape,
  curves: Curves,
) {
  const match = guide.neighbors.find((n) => n.face.IsSame(face));
  assert(match);
  const grown = guide.endSeams.flatMap((end) =>
    (end.growth ?? []).filter((part) => part.neighbor.IsSame(face)),
  );
  return [curves.orient(match.edge, start), ...grown.map((part) => part.edge)];
}

function sourceBoundaries(
  sourceFaces: Shape[],
  graph: Graph,
  curves: Curves,
  own: Own,
  nativeOwned: Shape[],
  nativeContacts: NativeContact[],
) {
  const k = getKernel();
  const { beginning, ending, orient } = curves;
  const changeCache: { old: Shape; replacement: Shape[] }[] = [];
  const mapped = (vertex: Shape, face: Shape) =>
    mappedVertex(graph, vertex, face);
  return sourceFaces.flatMap((face) => {
    if (nativeOwned.some((native) => native.IsSame(face)))
      return { original: face, face };
    const oldEdges = edges(face).map(own);
    const edits = oldEdges.flatMap((old) => {
      const guide = graph.find((p) => p.edge.IsSame(old));
      if (guide) {
        const start = mapped(beginning(old), face);
        assert(start);
        return [
          {
            edge: old,
            replacement: guideReplacement(guide, face, start, curves),
          },
        ];
      }
      const native = nativeContacts.filter(
        (contact) => contact.face.IsSame(face) && contact.old.IsSame(old),
      );
      if (native.length) {
        assert.equal(native.length, 1);
        const start = mapped(beginning(old), face);
        assert(start);
        const edge = native[0]!.edge;
        if (!edge) {
          const finish = mapped(ending(old), face);
          assert(finish && finish.IsSame(start));
          return [{ edge: old, replacement: [] }];
        }
        return [{ edge: old, replacement: [orient(edge, start)] }];
      }
      let cached = changeCache.find((c) => c.old.IsSame(old));
      if (!cached) {
        const replacement = changedBoundary(
          old,
          sourceFaces,
          graph,
          curves,
          own,
        );
        if (!replacement) return [];
        cached = { old, replacement };
        changeCache.push(cached);
      }
      const forward = old.Orientation_1() === cached.old.Orientation_1();
      const replacement = forward
        ? [...cached.replacement]
        : cached.replacement
            .toReversed()
            .map((edge) => own(k.TopoDS.Edge_1(own(edge.Reversed()))));
      return [{ edge: old, replacement }];
    });
    attachSourceEdits(face, oldEdges, edits, graph, own);
    attachCaps(face, edits, graph, curves, own);
    attachTerminations(face, oldEdges, edits, graph, curves, own);
    if (!edits.length) return { original: face, face };
    return planarFaceBoundary(face, edits, own, true).map((rebuilt) => ({
      original: face,
      face: rebuilt,
    }));
  });
}

function orientedEndBoundary(
  boundary: Shape[],
  start: Shape,
  curves: Curves,
  own: Own,
) {
  const remaining = [...boundary],
    ordered: Shape[] = [];
  let current = start;
  while (remaining.length) {
    const incident = remaining.filter((edge) =>
      vertices(edge)
        .map(own)
        .some((vertex) => vertex.IsSame(current)),
    );
    assert.equal(incident.length, 1);
    const edge = incident[0]!;
    remaining.splice(remaining.indexOf(edge), 1);
    const oriented = curves.orient(edge, current);
    ordered.push(oriented);
    current = curves.ending(oriented);
  }
  assert(!current.IsSame(start));
  return ordered;
}

function moduleBoundaries(graph: Graph, curves: Curves, own: Own) {
  const { beginning, orient } = curves;
  return graph.map((patch) => {
    const oldEdges = edges(patch.face).map(own);
    const edits = oldEdges.map((old) => {
      const line = patch.neighbors.find((n) => n.oldLine.IsSame(old));
      if (line) {
        const axis = V.normalize(V.sub(patch.points[1], patch.points[0])),
          mid = V.scale(V.add(patch.points[0], patch.points[1]), 0.5);
        const sign = Math.sign(
          V.dot(V.sub(vertexPoint(beginning(old)), mid), axis),
        );
        const start = line.contacts.find(
          (c) =>
            Math.sign(V.dot(V.sub(vertexPoint(c.old), mid), axis)) === sign,
        );
        assert(start);
        return { edge: old, replacement: [orient(line.edge, start.new)] };
      }
      const axis = V.normalize(V.sub(patch.points[1], patch.points[0])),
        mid = V.scale(V.add(patch.points[0], patch.points[1]), 0.5),
        sign = Math.sign(V.dot(V.sub(vertexPoint(beginning(old)), mid), axis));
      const end = patch.endSeams.find(
        (e) => Math.sign(V.dot(V.sub(vertexPoint(e.old), mid), axis)) === sign,
      );
      assert(end);
      const incident = patch.neighbors.find((n) =>
        vertices(n.oldLine)
          .map(own)
          .some((v) => v.IsSame(beginning(old))),
      );
      assert(incident);
      const start = incident.contacts.find((c) => c.old.IsSame(end.old));
      assert(start);
      return {
        edge: old,
        replacement: orientedEndBoundary(
          end.boundary.map((part) => part.edge),
          start.new,
          curves,
          own,
        ),
      };
    });
    return planarFaceBoundary(patch.face, edits, own);
  });
}

export function sharedFilletBoundaries(
  sourceFaces: Shape[],
  patches: Patch[],
  ends: FilletEnd[],
  own: Own,
  refuse: () => never,
  nativeOwned: Shape[] = [],
  nativeContacts: NativeContact[] = [],
) {
  const curves = nativeBoundaryCurves(own);
  const graph = guideGraph(sourceFaces, patches, ends, curves, own, refuse);
  return {
    replacements: sourceBoundaries(
      sourceFaces,
      graph,
      curves,
      own,
      nativeOwned,
      nativeContacts,
    ),
    madePatches: moduleBoundaries(graph, curves, own),
  };
}
