import { hash } from "node:crypto";
import {
  curveDistance,
  curveSamples,
  detectProfiles,
  LINEAR_TOL,
  onRound,
  projectEdge,
  seenEdgeOn,
  sketchCurves,
  UNIT_DOT_TOL,
  type BodyRef,
  type ExactCurve,
  type PlaneFrame,
  type SketchCurve,
  type SketchEntity,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  diagonal,
  edgeCentroid,
  edges,
  faces,
  getKernel,
  kernelCall,
  listToArray,
  progress,
  scoped,
  shapeList,
  wires,
  type Shape,
} from "./kernel.js";
import { cutOperation, fuseOperation } from "./boolean.js";
import { splitPlaneFace } from "./booleanTools.js";
import { exactCurve } from "./edgeCurve.js";
import { V } from "./frames.js";
import { computeEdgeNames, type NamedBody } from "./naming.js";
import { buildProfileFace } from "./sketchGeom.js";

export interface OutlinePiece {
  key: string;
  curve: ExactCurve;
}

type Named = readonly (readonly [string, Shape])[];
type XY = [number, number];

const REFUSED =
  "Project outlines bodies made of planar and cylindrical faces. Project its faces or edges instead.";
const UNBUILT =
  "Project could not outline this body. Project its faces or edges instead.";

const xyz = (d: any): Vec3 => [d.X(), d.Y(), d.Z()];

function flat(curve: ExactCurve, frame: PlaneFrame, id: string, ref: BodyRef) {
  try {
    return projectEdge(curve, frame, id, ref, false);
  } catch (error) {
    if (!seenEdgeOn(error)) throw error;
    if (curve.type === "line") return [];
    if (curve.type === "bspline" || curve.type === "other" || !curve.start)
      throw error;
    const chord = { type: "line" as const, a: curve.start, b: curve.end! };
    return projectEdge(chord, frame, id, ref, false);
  }
}

function boolean(shapes: Shape[], op: (a: Shape, b: Shape) => any): Shape {
  return shapes.slice(1).reduce((a, b) => {
    const made = op(a, b);
    if (!made.IsDone()) throw new Error(UNBUILT);
    return acquire(made.Shape());
  }, shapes[0]);
}

function seamOf(face: Shape): (edge: Shape) => boolean {
  const all = scoped((own) => {
    const k = getKernel();
    const E = k.TopAbs_ShapeEnum;
    const ex = own(
      new k.TopExp_Explorer_2(face, E.TopAbs_EDGE, E.TopAbs_SHAPE),
    );
    const out: Shape[] = [];
    for (; ex.More(); ex.Next()) out.push(own.keep(own(ex.Current())));
    return out;
  }).map(acquire);
  return (edge) => all.filter((e) => e.IsSame(edge)).length > 1;
}

export const memberKey = (name: string) => hash("sha256", name).slice(0, 8);

function namedOn(face: Shape, named: Named): Named {
  return scoped((own) => {
    const k = getKernel();
    const onFace = own(new k.TopTools_IndexedMapOfShape_1());
    k.TopExp.MapShapes_1(face, k.TopAbs_ShapeEnum.TopAbs_EDGE, onFace);
    const seam = seamOf(face);
    return named.filter(([, edge]) => onFace.Contains(edge) && !seam(edge));
  });
}

export const faceEdges = (face: Shape, named: Named): OutlinePiece[] =>
  namedOn(face, named).map(([name, edge]) => ({
    key: memberKey(name),
    curve: exactCurve(edge),
  }));

function loopRegion(loop: Shape, face: Shape, frame: PlaneFrame, ref: BodyRef) {
  const seam = seamOf(face);
  const entities: SketchEntity[] = edges(loop)
    .filter((edge) => !seam(edge))
    .flatMap((edge, i) => flat(exactCurve(edge), frame, `e${i}`, ref));
  const profiles = detectProfiles(entities);
  if (!profiles.length) throw new Error(UNBUILT);
  const regions = profiles.map((p) => buildProfileFace(p, entities, frame));
  return boolean(
    regions.map((r) => r.face),
    fuseOperation,
  );
}

function faceRegion(face: Shape, frame: PlaneFrame, ref: BodyRef): Shape {
  const k = getKernel();
  const outer = acquire(k.BRepTools.OuterWire(face));
  const loops = wires(face);
  const holes = loops.filter((w) => !w.IsSame(outer));
  return boolean(
    [outer, ...holes].map((w) => loopRegion(w, face, frame, ref)),
    cutOperation,
  );
}

function silhouettes(
  body: NamedBody,
  face: Shape,
  named: Named,
  frame: PlaneFrame,
  size: number,
): { parts: Shape[]; sources: OutlinePiece[] } {
  return scoped((own) => {
    const k = getKernel();
    const surface = own(new k.BRepAdaptor_Surface_2(face, true));
    const position = own(own(surface.Cylinder()).Axis());
    const axis = xyz(own(position.Direction()));
    if (Math.abs(V.dot(axis, frame.normal)) > 1 - UNIT_DOT_TOL)
      return { parts: [], sources: [] };
    const at = xyz(own(position.Location()));
    const n = frame.normal;
    const across = V.normalize(V.sub(n, V.scale(axis, V.dot(n, axis))));
    const side = V.cross(across, axis);
    const plane = splitPlaneFace(
      { origin: at, normal: across, xAxis: axis, yAxis: side },
      size,
      own,
    );
    const splitter = own(new k.BRepAlgoAPI_Splitter_1());
    splitter.SetArguments(shapeList([face]));
    splitter.SetTools(shapeList([plane]));
    splitter.Build(progress());
    if (!splitter.IsDone()) throw new Error(UNBUILT);
    const parts = faces(own(splitter.Shape()));
    const split = namedOn(face, named).flatMap(([name, edge]) => {
      const made = listToArray(splitter.Modified(edge)).map(own);
      return (made.length ? made : [edge]).map((p) => [name, p] as const);
    });
    const label = body.names.get(face);
    const sourceName = (edge: Shape) =>
      split.find(([, piece]) => piece.IsSame(edge))?.[0] ??
      `${label}/${V.dot(V.sub(edgeCentroid(edge), at), side) > 0 ? "+" : "-"}`;
    const sources = parts.flatMap((part) => {
      const seam = seamOf(part);
      return edges(part)
        .filter((edge) => !seam(edge))
        .map((edge) => ({
          key: memberKey(sourceName(edge)),
          curve: exactCurve(edge),
        }));
    });
    return { parts: parts.map(own.keep), sources };
  });
}

interface Source {
  key: string;
  curve: SketchCurve;
}

function shadows(body: NamedBody, frame: PlaneFrame, ref: BodyRef) {
  const k = getKernel();
  const size = diagonal(bboxOf(body.shape)) + 10;
  const T = k.GeomAbs_SurfaceType;
  const named = [...computeEdgeNames(body).byName];
  const found: OutlinePiece[] = [];
  const regions = faces(body.shape).flatMap((face) =>
    scoped((own): Shape[] => {
      const surface = own(new k.BRepAdaptor_Surface_2(face, true));
      const type = surface.GetType();
      if (type === T.GeomAbs_Plane) {
        const normal = xyz(own(own(own(surface.Plane()).Axis()).Direction()));
        if (Math.abs(V.dot(normal, frame.normal)) < UNIT_DOT_TOL) return [];
        found.push(...faceEdges(face, named));
        return [own.keep(faceRegion(face, frame, ref))];
      }
      if (type !== T.GeomAbs_Cylinder) throw new Error(REFUSED);
      const { parts, sources } = silhouettes(body, face, named, frame, size);
      found.push(...sources);
      return parts.map((half) =>
        own.keep(faceRegion(acquire(half), frame, ref)),
      );
    }).map(acquire),
  );
  const sources = found.flatMap(({ key, curve }) =>
    sketchCurves(flat(curve, frame, key, ref), true).map((drawn): Source => ({
      key,
      curve: drawn,
    })),
  );
  return { regions, sources };
}

function trace(c: SketchCurve, n: number): XY[] {
  if (c.kind === "line")
    return Array.from({ length: n + 1 }, (_, i) => [
      c.x1 + ((c.x2 - c.x1) * i) / n,
      c.y1 + ((c.y2 - c.y1) * i) / n,
    ]);
  const samples = curveSamples(c, n);
  return Array.from({ length: samples.length / 2 }, (_, i) => [
    samples[2 * i]!,
    samples[2 * i + 1]!,
  ]);
}

const on = (c: SketchCurve, [x, y]: XY) =>
  curveDistance(c, x, y) < LINEAR_TOL && (c.kind !== "arc" || onRound(c, x, y));

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sourceOf(
  curve: ExactCurve,
  frame: PlaneFrame,
  ref: BodyRef,
  sources: Source[],
) {
  const [drawn] = sketchCurves(flat(curve, frame, "o", ref), true);
  const probes = drawn ? trace(drawn, 4).slice(1, -1) : [];
  const [best] = sources
    .map((source) => ({
      source,
      hits: probes.filter((p) => on(source.curve, p)).length,
    }))
    .filter(({ hits }) => hits > 0)
    .toSorted((a, b) => b.hits - a.hits || order(a.source.key, b.source.key));
  if (!best) throw new Error(UNBUILT);
  const mid = probes[1]!;
  const along = trace(best.source.curve, 256).map((p) =>
    Math.hypot(p[0] - mid[0], p[1] - mid[1]),
  );
  return { key: best.source.key, at: along.indexOf(Math.min(...along)) };
}

function keyed(
  shape: Shape,
  frame: PlaneFrame,
  ref: BodyRef,
  sources: Source[],
): OutlinePiece[] {
  const runs = new Map<string, { curve: ExactCurve; at: number }[]>();
  for (const edge of edges(shape)) {
    const curve = exactCurve(edge);
    const { key, at } = sourceOf(curve, frame, ref, sources);
    runs.set(key, [...(runs.get(key) ?? []), { curve, at }]);
  }
  return [...runs]
    .flatMap(([key, run]) =>
      run.length === 1
        ? [{ key, curve: run[0]!.curve }]
        : run
            .toSorted((a, b) => a.at - b.at)
            .map(({ curve }, i) => ({ key: `${key}-${i + 1}`, curve })),
    )
    .toSorted((a, b) => order(a.key, b.key));
}

export function bodyOutline(
  body: NamedBody,
  frame: PlaneFrame,
  ref: BodyRef,
): OutlinePiece[] {
  try {
    return kernelCall("body outline", () =>
      scoped((own) => {
        const k = getKernel();
        const { regions, sources } = shadows(body, frame, ref);
        if (!regions.length) throw new Error(UNBUILT);
        const union = boolean(regions, fuseOperation);
        const unify = own(
          new k.ShapeUpgrade_UnifySameDomain_2(union, true, true, false),
        );
        unify.Build();
        return keyed(own(unify.Shape()), frame, ref, sources);
      }),
    );
  } catch (error) {
    const cause = (error as Error).cause;
    throw cause instanceof Error ? cause : new Error(UNBUILT, { cause: error });
  }
}
