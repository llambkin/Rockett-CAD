import {
  copyEdges,
  curveSamples,
  entityPointIds,
  sketchCurves,
  type ExactCurve,
  type PlaneFrame,
  type SketchCurve,
  type SketchEntity,
  type SketchPoint,
  type Vec3,
  ValidationError,
} from "@rockett/shared";
import { pointToUV, V } from "./frames.js";
import { acquire, getKernel, scoped, type Shape } from "./kernel.js";
import { computeEdgeNames, findFace, type NamedBody } from "./naming.js";
import { exactCurve } from "./edgeCurve.js";

type Pair = [number, string];

type CopyableCurve = Exclude<ExactCurve, { type: "other" }>;

type Polyline = [number, number][];

export interface Drawing {
  sketch: SketchEntity[];
  polylines: Polyline[];
}

interface FaceDrawing extends Drawing {
  unsupported: boolean;
}

const MIN_SPLITS = 3;
const MAX_SPLITS = 16;

const CONSTRUCTION = "CONSTRUCTION";

const LAYER_NAME = /^[!-~]{1,255}$/;

function real(v: number): string {
  const s = v.toFixed(9).replace(/0+$/, "").replace(/\.$/, ".0");
  return s === "-0.0" ? "0.0" : s;
}

function degrees(center: SketchPoint, p: SketchPoint): number {
  const a = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

function layer(name: string, color: number): Pair[] {
  return [
    [0, "LAYER"],
    [2, name],
    [70, "0"],
    [62, String(color)],
    [6, "CONTINUOUS"],
  ];
}

function section(name: string, body: Pair[]): Pair[] {
  return [[0, "SECTION"], [2, name], ...body, [0, "ENDSEC"]];
}

function layerTable(onLayer: string): Pair[] {
  const names = [...new Set(["0", onLayer, CONSTRUCTION])];
  return [
    [0, "TABLE"],
    [2, "LTYPE"],
    [70, "1"],
    [0, "LTYPE"],
    [2, "CONTINUOUS"],
    [70, "0"],
    [3, "Solid line"],
    [72, "65"],
    [73, "0"],
    [40, "0.0"],
    [0, "ENDTAB"],
    [0, "TABLE"],
    [2, "LAYER"],
    [70, String(names.length)],
    ...names.flatMap((name) => layer(name, name === CONSTRUCTION ? 8 : 7)),
    [0, "ENDTAB"],
  ];
}

function entityPairs(entities: readonly SketchEntity[], onLayer: string) {
  const points = new Map<string, SketchPoint>();
  const used = new Set<string>();
  for (const e of entities) {
    if (e.kind === "point") points.set(e.id, e);
    for (const id of entityPointIds(e)) used.add(id);
  }
  const at = (id: string) => {
    const p = points.get(id);
    if (!p) throw new Error(`sketch point ${id} is missing`);
    return p;
  };
  const xyz = (p: SketchPoint, code = 10): Pair[] => [
    [code, real(p.x)],
    [code + 10, real(p.y)],
    [code + 20, "0.0"],
  ];
  const out: Pair[] = [];
  for (const e of entities) {
    const entityLayer = e.construction ? CONSTRUCTION : onLayer;
    const head = (type: string): Pair[] => [
      [0, type],
      [8, entityLayer],
    ];
    if (e.kind === "point" && !used.has(e.id))
      out.push(...head("POINT"), ...xyz(e));
    if (e.kind === "line")
      out.push(...head("LINE"), ...xyz(at(e.p1)), ...xyz(at(e.p2), 11));
    if (e.kind === "circle")
      out.push(...head("CIRCLE"), ...xyz(at(e.center)), [40, real(e.radius)]);
    if (e.kind === "ellipse" || e.kind === "spline" || e.kind === "fitSpline")
      for (const curve of sketchCurves([e, ...points.values()], true))
        out.push(...polylinePairs([sampled(curve)], entityLayer));
    if (e.kind === "arc") {
      const c = at(e.center);
      const s = at(e.start);
      out.push(
        ...head("ARC"),
        ...xyz(c),
        [40, real(Math.hypot(s.x - c.x, s.y - c.y))],
        [50, real(degrees(c, s))],
        [51, real(degrees(c, at(e.end)))],
      );
    }
  }
  return out;
}

const ELLIPSE_SEGMENTS = 128;

function sampled(curve: SketchCurve): Polyline {
  const flat = curveSamples(curve, ELLIPSE_SEGMENTS);
  return Array.from({ length: flat.length / 2 }, (_, i) => [
    flat[2 * i]!,
    flat[2 * i + 1]!,
  ]);
}

function polylinePairs(
  polylines: readonly Polyline[],
  onLayer: string,
): Pair[] {
  const xy = ([x, y]: [number, number]): Pair[] => [
    [10, real(x)],
    [20, real(y)],
    [30, "0.0"],
  ];
  return polylines.flatMap((points): Pair[] => [
    [0, "POLYLINE"],
    [8, onLayer],
    [66, "1"],
    ...xy([0, 0]),
    ...points.flatMap((p): Pair[] => [[0, "VERTEX"], [8, onLayer], ...xy(p)]),
    [0, "SEQEND"],
    [8, onLayer],
  ]);
}

function gapToChord(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = V.sub(b, a);
  const t = Math.min(
    1,
    Math.max(0, V.dot(V.sub(p, a), ab) / (V.dot(ab, ab) || 1)),
  );
  return V.norm(V.sub(p, V.add(a, V.scale(ab, t))));
}

function sampleCurve(edge: Shape, quality: number): Vec3[] {
  const k = getKernel();
  return scoped((own) => {
    const curve = own(new k.BRepAdaptor_Curve_2(edge));
    const at = (u: number): Vec3 =>
      scoped((mine) => {
        const p = mine(curve.Value(u));
        return [p.X(), p.Y(), p.Z()];
      });
    const first = curve.FirstParameter();
    const points = [at(first)];
    const split = (a: number, pa: Vec3, b: number, pb: Vec3, depth: number) => {
      const m = (a + b) / 2;
      const pm = at(m);
      if (
        depth < MAX_SPLITS &&
        (depth < MIN_SPLITS || gapToChord(pm, pa, pb) > quality)
      ) {
        split(a, pa, m, pm, depth + 1);
        split(m, pm, b, pb, depth + 1);
      } else points.push(pb);
    };
    const last = curve.LastParameter();
    split(first, points[0]!, last, at(last), 0);
    return points;
  });
}

export function faceDrawing(
  body: NamedBody,
  faceName: string,
  frame: PlaneFrame,
  quality?: number,
): FaceDrawing {
  return scoped(() => {
    const k = getKernel();
    const face = findFace(body, faceName);
    if (!face) throw new Error(`face ${faceName} not found`);
    const onFace = acquire(new k.TopTools_IndexedMapOfShape_1());
    k.TopExp.MapShapes_1(face, k.TopAbs_ShapeEnum.TopAbs_EDGE, onFace);
    const curves: CopyableCurve[] = [];
    const others: Shape[] = [];
    for (const edge of computeEdgeNames(body).byName.values()) {
      if (!onFace.Contains(edge)) continue;
      const curve = exactCurve(edge);
      const asPolyline =
        curve.type === "other" ||
        (quality !== undefined && curve.type === "bspline");
      if (asPolyline) others.push(edge);
      else curves.push(curve);
    }
    const sketch = copyEdges(curves, frame);
    const traced = (edge: Shape): Polyline =>
      sampleCurve(edge, quality!).map((p) => {
        const { u, v } = pointToUV(frame, p);
        return [u, v];
      });
    return {
      sketch: sketch ?? [],
      polylines: quality === undefined ? [] : others.map(traced),
      unsupported: others.length > 0 || !sketch,
    };
  });
}

export function writeDxf(
  entities: readonly SketchEntity[],
  polylines: readonly Polyline[] = [],
  onLayer = "0",
): Buffer {
  if (!LAYER_NAME.test(onLayer))
    throw new ValidationError(
      "A DXF layer name is 1 to 255 printable ASCII characters without spaces",
    );
  const pairs = [
    ...section("HEADER", [
      [9, "$ACADVER"],
      [1, "AC1009"],
    ]),
    ...section("TABLES", layerTable(onLayer)),
    ...section("ENTITIES", [
      ...entityPairs(entities, onLayer),
      ...polylinePairs(polylines, onLayer),
    ]),
    [0, "EOF"] as Pair,
  ];
  return Buffer.from(
    pairs
      .map(([code, value]) => `${String(code).padStart(3)}\n${value}\n`)
      .join(""),
    "ascii",
  );
}
