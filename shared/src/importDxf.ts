import { newId, type SketchEntity, type SketchPoint } from "./model.js";
import { LINEAR_TOL } from "./tolerance.js";

export interface SketchImport {
  entities: SketchEntity[];
  skipped: number;
}

type Pair = [number, string];

interface DxfRecord {
  type: string;
  pairs: Pair[];
}

type XY = [number, number];

interface Vertex {
  at: XY;
  bulge: number;
}

const MM_PER_INSUNIT = [
  1, 25.4, 304.8, 1609344, 1, 10, 1000, 1e6, 2.54e-5, 0.0254, 914.4, 1e-7, 1e-6,
  1e-3, 100, 1e4, 1e5,
];

export function importDxf(text: string): SketchImport {
  if (text.startsWith("AutoCAD Binary DXF"))
    throw new Error(
      "Binary DXF is not supported. Save the drawing as ASCII DXF.",
    );
  const sections = readSections(readPairs(text));
  const scale = unitScale(sections.get("HEADER") ?? []);
  const sketch = sketchBuilder(scale);
  const records = splitRecords(sections.get("ENTITIES") ?? []);
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

type SketchBuilder = ReturnType<typeof sketchBuilder>;

const cell = (v: number) => Math.floor(v / LINEAR_TOL);
const flag = (construction: boolean) => (construction ? { construction } : {});
const finite = (...values: number[]) => values.every(Number.isFinite);

function sketchBuilder(scale: number) {
  const entities: SketchEntity[] = [];
  const grid = new Map<string, SketchPoint[]>();
  const apart = (a: XY, b: XY) =>
    Math.hypot(b[0] - a[0], b[1] - a[1]) * scale > LINEAR_TOL;
  const point = ([x, y]: XY, construction: boolean): SketchPoint => {
    const p: SketchPoint = {
      id: newId("pt"),
      kind: "point",
      x: x * scale,
      y: y * scale,
      ...flag(construction),
    };
    entities.push(p);
    return p;
  };
  const endpoint = (at: XY, construction: boolean): string => {
    const [x, y] = [at[0] * scale, at[1] * scale];
    const [gx, gy] = [cell(x), cell(y)];
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const p of grid.get(`${i},${j}`) ?? [])
          if (Math.hypot(p.x - x, p.y - y) <= LINEAR_TOL) {
            if (!construction) delete p.construction;
            return p.id;
          }
    const p = point(at, construction);
    const key = `${gx},${gy}`;
    grid.set(key, [...(grid.get(key) ?? []), p]);
    return p.id;
  };
  return {
    entities,
    point(at: XY, construction: boolean) {
      if (!finite(...at)) return false;
      point(at, construction);
      return true;
    },
    line(a: XY, b: XY, construction: boolean) {
      if (!finite(...a, ...b) || !apart(a, b)) return false;
      entities.push({
        id: newId("ln"),
        kind: "line",
        p1: endpoint(a, construction),
        p2: endpoint(b, construction),
        ...flag(construction),
      });
      return true;
    },
    circle(c: XY, r: number, construction: boolean) {
      if (!finite(...c, r) || !(r * scale > LINEAR_TOL)) return false;
      entities.push({
        id: newId("ci"),
        kind: "circle",
        center: point(c, construction).id,
        radius: r * scale,
        ...flag(construction),
      });
      return true;
    },
    arc(c: XY, s: XY, e: XY, construction: boolean) {
      if (!finite(...c, ...s, ...e) || !apart(s, e)) return false;
      entities.push({
        id: newId("arc"),
        kind: "arc",
        center: point(c, construction).id,
        start: endpoint(s, construction),
        end: endpoint(e, construction),
        ...flag(construction),
      });
      return true;
    },
  };
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
