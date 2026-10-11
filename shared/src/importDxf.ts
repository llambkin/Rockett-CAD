import {
  sketchBuilder,
  type SketchBuilder,
  type SketchImport,
  type XY,
} from "./sketchBuilder.js";
import { bsplineFromFlat, type BSpline } from "./bspline.js";
import { TAU } from "./sketchCurves.js";
import { LINEAR_TOL } from "./tolerance.js";

type Pair = [number, string];

interface DxfRecord {
  type: string;
  pairs: Pair[];
}

interface Vertex {
  at: XY;
  bulge: number;
}

const FULL_TURN_TOL = 1e-4;

const MM_PER_INSUNIT = [
  1, 25.4, 304.8, 1609344, 1, 10, 1000, 1e6, 2.54e-5, 0.0254, 914.4, 1e-7, 1e-6,
  1e-3, 100, 1e4, 1e5,
];

function readEntities(text: string) {
  if (text.startsWith("AutoCAD Binary DXF"))
    throw new Error(
      "Binary DXF is not supported. Save the drawing as ASCII DXF.",
    );
  const sections = readSections(readPairs(text));
  return {
    scale: unitScale(sections.get("HEADER") ?? []),
    records: splitRecords(sections.get("ENTITIES") ?? []),
  };
}

export function importDxf(text: string): SketchImport {
  const { scale, records } = readEntities(text);
  const sketch = sketchBuilder(scale);
  let skipped = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.type === "POLYLINE") {
      const vertices: DxfRecord[] = [];
      while (records[i + 1]?.type === "VERTEX") vertices.push(records[++i]!);
      if (records[i + 1]?.type === "SEQEND") i++;
      if (!addPolyline(sketch, record, vertices)) skipped++;
    } else if (!addEntity(sketch, record)) skipped++;
  }
  return { entities: sketch.entities, skipped };
}

export function dxfSplines(text: string): {
  splines: BSpline[];
  skipped: string[];
} {
  const { scale, records } = readEntities(text);
  const splines: BSpline[] = [];
  const skipped: string[] = [];
  for (const record of records.filter((r) => r.type === "SPLINE")) {
    const spline = splineOf(record, scale);
    if (typeof spline === "string") skipped.push(spline);
    else splines.push(spline);
  }
  return { splines, skipped };
}

function splineOf(record: DxfRecord, scale: number): BSpline | string {
  const values = (code: number) =>
    record.pairs.filter(([c]) => c === code).map(([, v]) => Number(v));
  const [knots, weights, xs, ys] = [
    values(40),
    values(41),
    values(10),
    values(20),
  ];
  if (xs.length === 0)
    return values(11).length > 0
      ? "fit points only: the control points are not stored"
      : "no control points";
  if (ys.length !== xs.length) return "control points need x and y";
  for (const [code, name, found] of [
    [72, "knots", knots.length],
    [73, "control points", xs.length],
  ] as const) {
    const declared = num(record, code, found);
    if (declared !== found)
      return `declares ${declared} ${name} but has ${found}`;
  }
  const poles = xs.map((x, i): XY => [x * scale, ys[i]! * scale]);
  return bsplineFromFlat(
    num(record, 71),
    poles,
    weights.length > 0 ? weights : undefined,
    knots,
  );
}

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    if (!/^-?\d+$/.test(code))
      throw new Error(
        `Not an ASCII DXF file: line ${i + 1} is not a group code.`,
      );
    pairs.push([Number(code), lines[i + 1]!.trim()]);
  }
  return pairs;
}

function readSections(pairs: Pair[]): Map<string, Pair[]> {
  const sections = new Map<string, Pair[]>();
  let current: Pair[] | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === "SECTION" && pairs[i + 1]?.[0] === 2) {
      current = [];
      sections.set(pairs[++i]![1], current);
    } else if (code === 0 && value === "ENDSEC") current = null;
    else current?.push(pairs[i]!);
  }
  return sections;
}

function unitScale(header: Pair[]): number {
  const at = header.findIndex(([c, v]) => c === 9 && v === "$INSUNITS");
  const pair = at < 0 ? undefined : header[at + 1];
  if (pair?.[0] !== 70) return 1;
  const scale = MM_PER_INSUNIT[Number(pair[1])];
  if (scale === undefined)
    throw new Error(`DXF units code ${pair[1]} is not supported.`);
  return scale;
}

function splitRecords(pairs: Pair[]): DxfRecord[] {
  const records: DxfRecord[] = [];
  for (const pair of pairs) {
    if (pair[0] === 0) records.push({ type: pair[1], pairs: [] });
    else records.at(-1)?.pairs.push(pair);
  }
  return records;
}

function num(record: DxfRecord, code: number, fallback = 0): number {
  const pair = record.pairs.find(([c]) => c === code);
  return pair === undefined ? fallback : Number(pair[1]);
}

function isConstruction(record: DxfRecord): boolean {
  return record.pairs.some(
    ([c, v]) => c === 8 && v.toUpperCase() === "CONSTRUCTION",
  );
}

function ocsMirror(record: DxfRecord): 1 | -1 | null {
  const nx = num(record, 210);
  const ny = num(record, 220);
  const nz = num(record, 230, 1);
  if (Math.abs(nx) > LINEAR_TOL || Math.abs(ny) > LINEAR_TOL) return null;
  return nz > 0 ? 1 : -1;
}

const xy = (record: DxfRecord, code: number): XY => [
  num(record, code),
  num(record, code + 10),
];

function addEntity(sketch: SketchBuilder, record: DxfRecord): boolean {
  const construction = isConstruction(record);
  const mirror = ocsMirror(record);
  const flip = ([x, y]: XY): XY => [(mirror ?? 1) * x, y];
  switch (record.type) {
    case "POINT":
      return sketch.point(xy(record, 10), construction);
    case "LINE":
      return sketch.line(xy(record, 10), xy(record, 11), construction);
    case "CIRCLE":
      return (
        mirror !== null &&
        sketch.circle(flip(xy(record, 10)), num(record, 40), construction)
      );
    case "ARC": {
      const [cx, cy] = xy(record, 10);
      const r = num(record, 40);
      if (mirror === null || !(r > 0)) return false;
      const [a0, a1] = [num(record, 50), num(record, 51)];
      if ((((a1 - a0) % 360) + 360) % 360 < 1e-9)
        return sketch.circle(flip([cx, cy]), r, construction);
      const at = (deg: number): XY =>
        flip([
          cx + r * Math.cos((deg * Math.PI) / 180),
          cy + r * Math.sin((deg * Math.PI) / 180),
        ]);
      const [s, e] = mirror > 0 ? [at(a0), at(a1)] : [at(a1), at(a0)];
      return sketch.arc(flip([cx, cy]), s, e, construction);
    }
    case "ELLIPSE": {
      const [c, major, ratio] = [
        xy(record, 10),
        xy(record, 11),
        num(record, 40),
      ];
      const [t0, t1] = [num(record, 41), num(record, 42, TAU)];
      if (mirror === null || !(ratio > 0 && ratio <= 1)) return false;
      const span = (((t1 - t0) % TAU) + TAU) % TAU;
      if (Math.min(span, TAU - span) <= FULL_TURN_TOL)
        return sketch.ellipse(c, major, ratio, construction);
      const at = (t: number): XY => [
        c[0] + Math.cos(t) * major[0] - Math.sin(t) * major[1] * ratio * mirror,
        c[1] + Math.cos(t) * major[1] + Math.sin(t) * major[0] * ratio * mirror,
      ];
      const ends: [XY, XY] = mirror > 0 ? [at(t0), at(t1)] : [at(t1), at(t0)];
      return sketch.ellipse(c, major, ratio, construction, ends);
    }
    case "SPLINE": {
      const spline = mirror !== null && splineOf(record, 1);
      return typeof spline === "object" && sketch.spline(spline, construction);
    }
    case "LWPOLYLINE": {
      const vertices: Vertex[] = [];
      for (const [code, value] of record.pairs) {
        if (code === 10) vertices.push({ at: [Number(value), 0], bulge: 0 });
        const last = vertices.at(-1);
        if (last && code === 20) last.at[1] = Number(value);
        if (last && code === 42) last.bulge = Number(value);
      }
      return addChain(sketch, record, vertices, (num(record, 70) & 1) === 1);
    }
    default:
      return false;
  }
}

function addPolyline(
  sketch: SketchBuilder,
  record: DxfRecord,
  vertexRecords: DxfRecord[],
): boolean {
  const flags = num(record, 70);
  if (flags & (8 | 16 | 64)) return false;
  const vertices = vertexRecords
    .filter((v) => (num(v, 70) & 16) === 0)
    .map((v) => ({ at: xy(v, 10), bulge: num(v, 42) }));
  return addChain(sketch, record, vertices, (flags & 1) === 1);
}

function addChain(
  sketch: SketchBuilder,
  record: DxfRecord,
  vertices: Vertex[],
  closed: boolean,
): boolean {
  const mirror = ocsMirror(record);
  if (mirror === null) return false;
  const construction = isConstruction(record);
  const wcs = vertices.map(({ at, bulge }) => ({
    at: [mirror * at[0], at[1]] as XY,
    bulge: mirror * bulge,
  }));
  const count = closed ? wcs.length : wcs.length - 1;
  let added = false;
  for (let i = 0; i < count; i++) {
    const { at: a, bulge } = wcs[i]!;
    const b = wcs[(i + 1) % wcs.length]!.at;
    if (Math.abs(bulge) < 1e-12) {
      added = sketch.line(a, b, construction) || added;
      continue;
    }
    const k = (1 - bulge * bulge) / (4 * bulge);
    const c: XY = [
      (a[0] + b[0]) / 2 - k * (b[1] - a[1]),
      (a[1] + b[1]) / 2 + k * (b[0] - a[0]),
    ];
    const [s, e] = bulge > 0 ? [a, b] : [b, a];
    added = sketch.arc(c, s, e, construction) || added;
  }
  return added;
}
