import type { SketchConstraint, SketchEntity, Units } from "@rockett/shared";
import {
  LINEAR_TOL,
  newId,
  normalizeDegrees,
  parseLength,
  UNIT_DOT_TOL,
} from "@rockett/shared";

export interface Created {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  chainPointId?: string;
}

export interface UV {
  x: number;
  y: number;
  snapPointId?: string | undefined;
  snapLineId?: string | undefined;
  snapCircleId?: string | undefined;
  snapMidLineId?: string | undefined;
  snapPerpLineId?: string | undefined;
  snapKind?: "point" | "midpoint" | "curve" | "origin" | "perpendicular";
}

export function rayLineIntersection(
  A: { x: number; y: number },
  r: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  slack = 0,
): { x: number; y: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = r.x * dy - r.y * dx;
  const segLen = Math.hypot(dx, dy);
  if (Math.abs(denom) < 1e-12 || segLen < 1e-12) return null;
  const t = ((a.x - A.x) * dy - (a.y - A.y) * dx) / denom;
  const s = ((a.x - A.x) * r.y - (a.y - A.y) * r.x) / denom;
  if (t <= 1e-9) return null;
  const sl = slack / segLen;
  if (s < -sl || s > 1 + sl) return null;
  return { x: A.x + t * r.x, y: A.y + t * r.y };
}

const PERP_SNAP_DEG = 4;

export function perpendicularSnap(
  from: UV,
  cursor: { x: number; y: number },
  entities: SketchEntity[],
  minLen = 0,
): UV | null {
  const dx = cursor.x - from.x;
  const dy = cursor.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= minLen || len < 1e-9) return null;
  const pts = new Map<string, { x: number; y: number }>();
  for (const e of entities) if (e.kind === "point") pts.set(e.id, e);
  const touches = (pid: string) => {
    if (from.snapPointId && pid === from.snapPointId) return true;
    const p = pts.get(pid);
    return (
      !!p && Math.abs(p.x - from.x) < 1e-9 && Math.abs(p.y - from.y) < 1e-9
    );
  };
  const maxSin = Math.sin((PERP_SNAP_DEG * Math.PI) / 180);
  let best: { lineId: string; off: number; lx: number; ly: number } | null =
    null;
  for (const e of entities) {
    if (e.kind !== "line") continue;
    if (!touches(e.p1) && !touches(e.p2)) continue;
    const a = pts.get(e.p1);
    const b = pts.get(e.p2);
    if (!a || !b) continue;
    const ll = Math.hypot(b.x - a.x, b.y - a.y);
    if (ll < 1e-9) continue;
    const lx = (b.x - a.x) / ll;
    const ly = (b.y - a.y) / ll;
    const off = Math.abs((dx * lx + dy * ly) / len);
    if (off < maxSin && (!best || off < best.off))
      best = { lineId: e.id, off, lx, ly };
  }
  if (!best) return null;
  const nx = -best.ly;
  const ny = best.lx;
  const sgn = dx * nx + dy * ny < 0 ? -1 : 1;
  const axisTol = 1e-9;
  if (Math.abs(best.lx) < axisTol) {
    return {
      x: from.x + (dx < 0 ? -len : len),
      y: from.y,
      snapKind: "perpendicular",
    };
  }
  if (Math.abs(best.ly) < axisTol) {
    return {
      x: from.x,
      y: from.y + (dy < 0 ? -len : len),
      snapKind: "perpendicular",
    };
  }
  return {
    x: from.x + sgn * len * nx,
    y: from.y + sgn * len * ny,
    snapPerpLineId: best.lineId,
    snapKind: "perpendicular",
  };
}

export function pointOrExisting(
  uv: UV,
  construction: boolean | undefined,
  out: SketchEntity[],
  constraints?: SketchConstraint[],
): string {
  if (uv.snapPointId) return uv.snapPointId;
  const id = newId("pt");
  out.push({
    id,
    kind: "point",
    x: uv.x,
    y: uv.y,
    ...(construction === undefined ? {} : { construction }),
  });
  if (constraints) {
    if (uv.snapMidLineId) {
      constraints.push({
        id: newId("c"),
        type: "midpoint",
        point: id,
        line: uv.snapMidLineId,
      });
    } else if (uv.snapLineId) {
      constraints.push({
        id: newId("c"),
        type: "pointOnLine",
        point: id,
        line: uv.snapLineId,
      });
    } else if (uv.snapCircleId) {
      constraints.push({
        id: newId("c"),
        type: "pointOnCircle",
        point: id,
        circle: uv.snapCircleId,
      });
    } else if (
      uv.snapKind === "origin" ||
      uv.snapKind === "midpoint" ||
      uv.snapKind === "point"
    ) {
      constraints.push({ id: newId("c"), type: "fix", point: id });
    }
  }
  return id;
}

export function createLine(a: UV, b: UV, construction?: boolean): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const p1 = pointOrExisting(a, construction, entities, constraints);
  const p2 = pointOrExisting(b, construction, entities, constraints);
  const lineId = newId("ln");
  entities.push({
    id: lineId,
    kind: "line",
    p1,
    p2,
    ...(construction === undefined ? {} : { construction }),
  });
  if (a.x === b.x && a.y !== b.y) {
    constraints.push({ id: newId("c"), type: "vertical", line: lineId });
  } else if (a.y === b.y && a.x !== b.x) {
    constraints.push({ id: newId("c"), type: "horizontal", line: lineId });
  } else if (b.snapPerpLineId) {
    constraints.push({
      id: newId("c"),
      type: "perpendicular",
      a: b.snapPerpLineId,
      b: lineId,
    });
  }
  return { entities, constraints, chainPointId: p2 };
}

export function createRect(a: UV, b: UV): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const pa = pointOrExisting(a, undefined, entities, constraints);
  const pbId = newId("pt");
  const pcId = pointOrExisting(b, undefined, entities, constraints);
  const pdId = newId("pt");
  entities.push({ id: pbId, kind: "point", x: b.x, y: a.y });
  entities.push({ id: pdId, kind: "point", x: a.x, y: b.y });
  const l1 = newId("ln"),
    l2 = newId("ln"),
    l3 = newId("ln"),
    l4 = newId("ln");
  entities.push({ id: l1, kind: "line", p1: pa, p2: pbId });
  entities.push({ id: l2, kind: "line", p1: pbId, p2: pcId });
  entities.push({ id: l3, kind: "line", p1: pcId, p2: pdId });
  entities.push({ id: l4, kind: "line", p1: pdId, p2: pa });
  constraints.push({ id: newId("c"), type: "horizontal", line: l1 });
  constraints.push({ id: newId("c"), type: "horizontal", line: l3 });
  constraints.push({ id: newId("c"), type: "vertical", line: l2 });
  constraints.push({ id: newId("c"), type: "vertical", line: l4 });
  return { entities, constraints };
}

export function createCenterRect(center: UV, corner: UV): Created {
  const w = Math.abs(corner.x - center.x) * 2;
  const h = Math.abs(corner.y - center.y) * 2;
  const a: UV = { x: center.x - w / 2, y: center.y - h / 2 };
  const b: UV = { x: center.x + w / 2, y: center.y + h / 2 };
  const rect = createRect(a, b);
  const centerId = pointOrExisting(
    center,
    true,
    rect.entities,
    rect.constraints,
  );
  const sides = rect.entities.filter((e) => e.kind === "line");
  const diagonalId = newId("ln");
  rect.entities.push({
    id: diagonalId,
    kind: "line",
    p1: sides[0]!.p1,
    p2: sides[1]!.p2,
    construction: true,
  });
  rect.constraints.push({
    id: newId("c"),
    type: "midpoint",
    point: centerId,
    line: diagonalId,
  });
  return rect;
}

export function createCircle(center: UV, edge: UV): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const c = pointOrExisting(center, undefined, entities, constraints);
  const r = Math.max(Math.hypot(edge.x - center.x, edge.y - center.y), 0.01);
  entities.push({ id: newId("ci"), kind: "circle", center: c, radius: r });
  return { entities, constraints };
}

export function ellipseMinor(c: UV, m: UV, q: UV): UV | null {
  const [ux, uy] = [m.x - c.x, m.y - c.y];
  const a = Math.hypot(ux, uy);
  const side = (ux * (q.y - c.y) - uy * (q.x - c.x)) / (a || 1);
  if (!(a > LINEAR_TOL && Math.abs(side) > LINEAR_TOL)) return null;
  return { x: c.x - (uy / a) * side, y: c.y + (ux / a) * side };
}

export function createEllipse(c: UV, m: UV, q: UV): Created | null {
  const n = ellipseMinor(c, m, q);
  if (!n) return null;
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const center = pointOrExisting(c, undefined, entities, constraints);
  const major = pointOrExisting(m, undefined, entities, constraints);
  const minor = pointOrExisting(n, undefined, entities);
  entities.push({ id: newId("el"), kind: "ellipse", center, major, minor });
  return { entities, constraints };
}

export function createArc3(start: UV, end: UV, on: UV): Created | null {
  const ax = start.x,
    ay = start.y,
    bx = on.x,
    by = on.y,
    cx = end.x,
    cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const entities: SketchEntity[] = [];
  const arcConstraints: SketchConstraint[] = [];
  const centerId = newId("pt");
  entities.push({
    id: centerId,
    kind: "point",
    x: ux,
    y: uy,
    construction: true,
  });
  const s = pointOrExisting(start, undefined, entities, arcConstraints);
  const e = pointOrExisting(end, undefined, entities, arcConstraints);
  const a0 = Math.atan2(ay - uy, ax - ux);
  let a1 = Math.atan2(cy - uy, cx - ux);
  let am = Math.atan2(by - uy, bx - ux);
  while (a1 <= a0) a1 += Math.PI * 2;
  while (am <= a0) am += Math.PI * 2;
  const ccwContains = am <= a1;
  entities.push({
    id: newId("arc"),
    kind: "arc",
    center: centerId,
    start: ccwContains ? s : e,
    end: ccwContains ? e : s,
  });
  return { entities, constraints: arcConstraints };
}

export type PolygonType = "inscribed" | "circumscribed";

export interface PolygonOptions {
  sides: number;
  type: PolygonType;
  angle: number | null;
}

export function polygonVertices(
  center: UV,
  cursor: UV,
  { sides, type, angle }: PolygonOptions,
): { x: number; y: number }[] {
  const r = Math.hypot(cursor.x - center.x, cursor.y - center.y);
  const reach = type === "inscribed" ? r : r / Math.cos(Math.PI / sides);
  const a0 =
    angle === null
      ? Math.atan2(cursor.y - center.y, cursor.x - center.x)
      : (angle * Math.PI) / 180;
  return Array.from({ length: sides }, (_, i) => {
    const a = a0 + (i / sides) * Math.PI * 2;
    return {
      x: center.x + reach * Math.cos(a),
      y: center.y + reach * Math.sin(a),
    };
  });
}

export function createPolygon(
  center: UV,
  cursor: UV,
  options: PolygonOptions,
): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const point = (v: { x: number; y: number }, construction = false) => {
    const id = newId("pt");
    entities.push({ id, kind: "point", x: v.x, y: v.y, construction });
    return id;
  };
  const line = (p1: string, p2: string, construction = false) => {
    const id = newId("ln");
    entities.push({ id, kind: "line", p1, p2, construction });
    return id;
  };
  const c = pointOrExisting(center, undefined, entities, constraints);
  const circle = newId("ci");
  const radius = Math.hypot(cursor.x - center.x, cursor.y - center.y);
  entities.push({
    id: circle,
    kind: "circle",
    center: c,
    radius,
    construction: true,
  });
  const vertices = polygonVertices(center, cursor, options);
  const pointIds = vertices.map((v) => point(v));
  const lineIds = pointIds.map((p, i) =>
    line(p, pointIds[(i + 1) % pointIds.length]!),
  );
  for (const [i, l] of lineIds.entries()) {
    constraints.push(
      options.type === "inscribed"
        ? { id: newId("c"), type: "pointOnCircle", point: pointIds[i]!, circle }
        : { id: newId("c"), type: "tangent", a: l, b: circle },
    );
    if (i > 0)
      constraints.push({ id: newId("c"), type: "equal", a: lineIds[0]!, b: l });
  }
  if (options.type === "circumscribed" && vertices.length % 2 === 0) {
    const [a, b] = [vertices[0]!, vertices[1]!];
    const touch = point({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, true);
    const spoke = line(c, touch, true);
    constraints.push(
      { id: newId("c"), type: "midpoint", point: touch, line: lineIds[0]! },
      { id: newId("c"), type: "perpendicular", a: spoke, b: lineIds[0]! },
    );
  }
  if (options.angle !== null)
    constraints.push({
      id: newId("c"),
      type: "lineAngle",
      line: line(c, pointIds[0]!, true),
      value: normalizeDegrees(options.angle),
    });
  return { entities, constraints };
}

export function createSlot(c1: UV, c2: UV, r: number): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const dx = c2.x - c1.x,
    dy = c2.y - c1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len,
    ny = dx / len;
  const p = (x: number, y: number, construction = false) => {
    const id = newId("pt");
    entities.push({ id, kind: "point", x, y, construction });
    return id;
  };
  const cA = p(c1.x, c1.y, true);
  const cB = p(c2.x, c2.y, true);
  const a1 = p(c1.x + nx * r, c1.y + ny * r);
  const a2 = p(c1.x - nx * r, c1.y - ny * r);
  const b1 = p(c2.x + nx * r, c2.y + ny * r);
  const b2 = p(c2.x - nx * r, c2.y - ny * r);
  const lt = newId("ln"),
    lb = newId("ln");
  entities.push({ id: lt, kind: "line", p1: a1, p2: b1 });
  entities.push({ id: lb, kind: "line", p1: b2, p2: a2 });
  entities.push({
    id: newId("arc"),
    kind: "arc",
    center: cB,
    start: b1,
    end: b2,
  });
  entities.push({
    id: newId("arc"),
    kind: "arc",
    center: cA,
    start: a2,
    end: a1,
  });
  constraints.push({ id: newId("c"), type: "parallel", a: lt, b: lb });
  return { entities, constraints };
}

export function createPoint(at: UV, construction?: boolean): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  pointOrExisting(
    { ...at, snapPointId: undefined },
    construction,
    entities,
    constraints,
  );
  return { entities, constraints };
}

export type DimTarget = {
  kind: "point" | "line" | "circle" | "arc";
  id: string;
};

type XY = { x: number; y: number };

function geometry(entities: SketchEntity[]) {
  const at = new Map(entities.map((e) => [e.id, e]));
  const point = (id: string): XY => {
    const p = at.get(id);
    if (p?.kind !== "point") throw new Error(`unknown point ${id}`);
    return p;
  };
  const line = (id: string) => {
    const l = at.get(id);
    if (l?.kind !== "line") throw new Error(`unknown line ${id}`);
    return { a: point(l.p1), b: point(l.p2) };
  };
  const radius = (id: string) => {
    const e = at.get(id);
    if (e?.kind === "circle") return e.radius;
    if (e?.kind === "arc") {
      const c = point(e.center);
      const p = point(e.start);
      return Math.hypot(p.x - c.x, p.y - c.y);
    }
    throw new Error(`entity ${id} has no radius`);
  };
  const offset = (lineId: string, p: XY) => {
    const { a, b } = line(lineId);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    return (dx * (p.y - a.y) - dy * (p.x - a.x)) / (Math.hypot(dx, dy) || 1);
  };
  const direction = (lineId: string) => {
    const { a, b } = line(lineId);
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  return { point, line, radius, offset, direction };
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

export function measureDimension(
  c: SketchConstraint,
  entities: SketchEntity[],
): number {
  const g = geometry(entities);
  switch (c.type) {
    case "length": {
      const { a, b } = g.line(c.line);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    case "distance": {
      const a = g.point(c.a),
        b = g.point(c.b);
      if (c.axis === "x") return Math.abs(b.x - a.x);
      if (c.axis === "y") return Math.abs(b.y - a.y);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    case "radius":
      return g.radius(c.entity);
    case "diameter":
      return 2 * g.radius(c.entity);
    case "angle": {
      const diff = g.direction(c.b) - g.direction(c.a);
      return degrees(Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff))));
    }
    case "lineAngle":
      return normalizeDegrees(
        degrees(g.direction(c.line)) - (c.axis === "y" ? 90 : 0),
      );
    case "pointLineDistance":
      return Math.abs(g.offset(c.line, g.point(c.point)));
    case "lineDistance":
      return Math.abs(g.offset(c.a, g.line(c.b).a));
    default:
      return 0;
  }
}

function measured(c: SketchConstraint, entities: SketchEntity[]) {
  return { ...c, value: measureDimension(c, entities) } as SketchConstraint;
}

function parallel(entities: SketchEntity[], a: string, b: string): boolean {
  const g = geometry(entities);
  return Math.abs(Math.sin(g.direction(a) - g.direction(b))) < UNIT_DOT_TOL;
}

export function dimensionFor(
  targets: DimTarget[],
  entities: SketchEntity[],
): SketchConstraint | null {
  const [a, b, ...rest] = targets.filter(
    (t, i) => targets.findIndex((u) => u.id === t.id) === i,
  );
  if (!a || rest.length) return null;
  const id = newId("c");
  const value = 0;
  if (!b) {
    if (a.kind === "line")
      return measured({ id, type: "length", line: a.id, value }, entities);
    if (a.kind === "circle" || a.kind === "arc")
      return measured({ id, type: "diameter", entity: a.id, value }, entities);
    return null;
  }
  if (a.kind === "point" && b.kind === "point")
    return measured(
      { id, type: "distance", a: a.id, b: b.id, axis: null, value },
      entities,
    );
  const point = [a, b].find((t) => t.kind === "point");
  const line = [a, b].find((t) => t.kind === "line");
  if (point && line)
    return measured(
      { id, type: "pointLineDistance", point: point.id, line: line.id, value },
      entities,
    );
  if (a.kind !== "line" || b.kind !== "line") return null;
  const type = parallel(entities, a.id, b.id) ? "lineDistance" : "angle";
  return measured({ id, type, a: a.id, b: b.id, value }, entities);
}

const kind = (label: string, constraint: SketchConstraint) => ({
  label,
  constraint,
});

function dimensionKinds(c: SketchConstraint) {
  const { id } = c;
  const value = 0;
  switch (c.type) {
    case "distance": {
      const pair = { id, type: c.type, a: c.a, b: c.b, value };
      return [
        kind("Aligned distance", { ...pair, axis: null }),
        kind("Horizontal distance", { ...pair, axis: "x" }),
        kind("Vertical distance", { ...pair, axis: "y" }),
      ];
    }
    case "radius":
    case "diameter":
      return [
        kind("Radius", { id, type: "radius", entity: c.entity, value }),
        kind("Diameter", { id, type: "diameter", entity: c.entity, value }),
      ];
    case "length":
    case "lineAngle": {
      const angle = { id, type: "lineAngle", line: c.line, value } as const;
      return [
        kind("Length", { id, type: "length", line: c.line, value }),
        kind("Angle to X axis", angle),
        kind("Angle to Y axis", { ...angle, axis: "y" }),
      ];
    }
    default:
      return [];
  }
}

const dimensionKind = (c: SketchConstraint) =>
  `${c.type}:${"axis" in c ? (c.axis ?? "") : ""}`;

export function dimensionChoices(
  c: SketchConstraint,
  entities: SketchEntity[],
) {
  return dimensionKinds(c)
    .filter((k) => dimensionKind(k.constraint) !== dimensionKind(c))
    .map(({ label, constraint }) => ({
      label,
      constraint: measured(constraint, entities),
    }));
}

export function chooseDimension(
  constraints: SketchConstraint[],
  choice: SketchConstraint,
): SketchConstraint[] {
  return dedupeDimensions(
    withoutAxisLocks(constraints.map((c) => (c.id === choice.id ? choice : c))),
    choice.id,
  );
}

export function asConstruction(created: Created): Created {
  return {
    ...created,
    entities: created.entities.map((e) => ({ ...e, construction: true })),
  };
}

export function dimensionKey(c: SketchConstraint): string | null {
  const x = c as any;
  switch (c.type) {
    case "length":
      return `length:${x.line}`;
    case "lineAngle":
      return `lineAngle:${x.line}`;
    case "radius":
    case "diameter":
      return `size:${x.entity}`;
    case "distance":
      return `distance:${[x.a, x.b].toSorted().join("|")}:${x.axis ?? ""}`;
    case "angle":
      return `angle:${[x.a, x.b].toSorted().join("|")}`;
    case "lineDistance":
      return `lineDistance:${[x.a, x.b].toSorted().join("|")}`;
    case "pointLineDistance":
      return `pointLine:${x.point}|${x.line}`;
    default:
      return null;
  }
}

export function findExistingDimension(
  constraints: SketchConstraint[],
  candidate: SketchConstraint,
): SketchConstraint | undefined {
  const key = dimensionKey(candidate);
  if (!key) return undefined;
  return constraints.find(
    (c) => c.id !== candidate.id && dimensionKey(c) === key,
  );
}

export function dedupeDimensions(
  constraints: SketchConstraint[],
  keepId?: string,
): SketchConstraint[] {
  const winners = new Map<string, string>();
  for (const c of constraints) {
    const key = dimensionKey(c);
    if (!key) continue;
    if (c.id === keepId || !winners.has(key)) winners.set(key, c.id);
  }
  return constraints.filter((c) => {
    const key = dimensionKey(c);
    return !key || winners.get(key) === c.id;
  });
}

export type DimKey = "length" | "angle" | "width" | "height" | "diameter";

export interface DimField {
  key: DimKey;
  label: string;
  unit: Units | "°" | "";
  text: string;
  locked: boolean;
}

export function fmt2(v: number): string {
  return String(Math.round(v * 100) / 100);
}

const dimField = (key: DimKey, label: string, unit: Units | "°"): DimField => ({
  key,
  label,
  unit,
  text: "",
  locked: false,
});
export function dimFieldsFor(
  tool: string,
  units: Units = "mm",
): DimField[] | null {
  switch (tool) {
    case "line":
      return [dimField("length", "L", units), dimField("angle", "∠", "°")];
    case "rect":
    case "centerRect":
      return [dimField("width", "W", units), dimField("height", "H", units)];
    case "circle":
      return [dimField("diameter", "⌀", units)];
    default:
      return null;
  }
}

export function liveDimValues(
  tool: string,
  a: UV,
  c: UV,
): Partial<Record<DimKey, number>> {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  switch (tool) {
    case "line": {
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      return { length: Math.hypot(dx, dy), angle: ((deg % 360) + 360) % 360 };
    }
    case "rect":
      return { width: Math.abs(dx), height: Math.abs(dy) };
    case "centerRect":
      return { width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
    case "circle":
      return { diameter: Math.hypot(dx, dy) * 2 };
    default:
      return {};
  }
}

export function lockedValue(fields: DimField[], key: DimKey): number | null {
  const f = fields.find((x) => x.key === key);
  if (!f?.locked) return null;
  if (key === "angle") {
    const v = Number(f.text);
    return f.text.trim() && Number.isFinite(v) ? v : null;
  }
  const mm = parseLength(f.text, f.unit === "°" ? "mm" : f.unit || "mm");
  return mm !== null && mm > 0 ? mm : null;
}

const sgn = (v: number) => (v < 0 ? -1 : 1);
export function resolveDimCursor(
  tool: string,
  a: UV,
  c: UV,
  fields: DimField[],
): UV {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const len = Math.hypot(dx, dy);
  const dir: [number, number] = len > 1e-9 ? [dx / len, dy / len] : [1, 0];
  switch (tool) {
    case "line": {
      const L = lockedValue(fields, "length");
      const A = lockedValue(fields, "angle");
      if (L === null && A === null) return c;
      const length = L ?? len;
      if (A === null) {
        const out: UV = { x: a.x + length * dir[0], y: a.y + length * dir[1] };
        if (c.snapPerpLineId) out.snapPerpLineId = c.snapPerpLineId;
        return out;
      }
      return pointAtAngle(a, length, A);
    }
    case "rect":
    case "centerRect": {
      const W = lockedValue(fields, "width");
      const H = lockedValue(fields, "height");
      if (W === null && H === null) return c;
      const half = tool === "centerRect" ? 0.5 : 1;
      const w = W !== null ? W * half : Math.abs(dx);
      const h = H !== null ? H * half : Math.abs(dy);
      return { x: a.x + sgn(dx) * w, y: a.y + sgn(dy) * h };
    }
    case "circle": {
      const D = lockedValue(fields, "diameter");
      if (D === null) return c;
      return { x: a.x + (D / 2) * dir[0], y: a.y + (D / 2) * dir[1] };
    }
    default:
      return c;
  }
}

function pointAtAngle(a: UV, length: number, deg: number): UV {
  const quarter = Math.round(deg / 90);
  if (Math.abs(deg - quarter * 90) < 1e-9) {
    const k = ((quarter % 4) + 4) % 4;
    return {
      x: a.x + [length, 0, -length, 0][k]!,
      y: a.y + [0, length, 0, -length][k]!,
    };
  }
  const rad = (deg * Math.PI) / 180;
  return { x: a.x + length * Math.cos(rad), y: a.y + length * Math.sin(rad) };
}

export function snapAngle(
  deg: number,
  step: number,
  angles: readonly number[],
): number {
  let best = Math.round(deg / step) * step;
  for (const angle of angles)
    for (const target of [angle, angle + 180]) {
      const near = target + Math.round((deg - target) / 360) * 360;
      if (Math.abs(near - deg) < Math.abs(best - deg)) best = near;
    }
  return best;
}

export function snapLineEnd(
  a: UV,
  c: UV,
  step: number,
  angles: readonly number[],
): UV {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { x: c.x, y: c.y };
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return pointAtAngle(a, length, snapAngle(deg, step, angles));
}

export function toggleAngleLock(fields: DimField[], live: number): void {
  const f = fields.find((x) => x.key === "angle");
  if (!f) return;
  f.locked = !f.locked;
  f.text = fmt2(live);
}

export function dimConstraintsFor(
  tool: string,
  created: Created,
  fields: DimField[],
): SketchConstraint[] {
  const out: SketchConstraint[] = [];
  const lines = created.entities.filter((e) => e.kind === "line");
  const L = lockedValue(fields, "length");
  if (tool === "line" && L !== null && lines[0]) {
    out.push({ id: newId("c"), type: "length", line: lines[0].id, value: L });
  }
  const A = lockedValue(fields, "angle");
  if (tool === "line" && A !== null && lines[0]) {
    out.push({
      id: newId("c"),
      type: "lineAngle",
      line: lines[0].id,
      value: normalizeDegrees(A),
    });
  }
  if ((tool === "rect" || tool === "centerRect") && lines.length >= 2) {
    const W = lockedValue(fields, "width");
    const H = lockedValue(fields, "height");
    if (W !== null)
      out.push({
        id: newId("c"),
        type: "length",
        line: lines[0]!.id,
        value: W,
      });
    if (H !== null)
      out.push({
        id: newId("c"),
        type: "length",
        line: lines[1]!.id,
        value: H,
      });
  }
  const D = lockedValue(fields, "diameter");
  const circle = created.entities.find((e) => e.kind === "circle");
  if (tool === "circle" && D !== null && circle) {
    out.push({ id: newId("c"), type: "diameter", entity: circle.id, value: D });
  }
  return out;
}

export function pinTypedDims(
  tool: string,
  created: Created,
  fields: DimField[],
): Created {
  return {
    ...created,
    constraints: withoutAxisLocks([
      ...created.constraints,
      ...dimConstraintsFor(tool, created, fields),
    ]),
  };
}

function withoutAxisLocks(constraints: SketchConstraint[]): SketchConstraint[] {
  const angled = new Set(
    constraints.flatMap((c) => (c.type === "lineAngle" ? [c.line] : [])),
  );
  return constraints.filter(
    (c) =>
      !(
        (c.type === "horizontal" || c.type === "vertical") &&
        angled.has(c.line)
      ),
  );
}

export function lineDimensions(
  lineId: string,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
): { constraints: SketchConstraint[]; lengthId: string; angleId: string } {
  const line = entities.find((e) => e.id === lineId);
  const point = (id: string | undefined) =>
    entities.find((e) => e.id === id && e.kind === "point");
  const a = point(line?.kind === "line" ? line.p1 : undefined);
  const b = point(line?.kind === "line" ? line.p2 : undefined);
  if (a?.kind !== "point" || b?.kind !== "point")
    throw new Error(`unknown line ${lineId}`);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length =
    constraints.find((c) => c.type === "length" && c.line === lineId) ??
    ({
      id: newId("c"),
      type: "length",
      line: lineId,
      value: Math.hypot(dx, dy),
    } satisfies SketchConstraint);
  const angle =
    constraints.find((c) => c.type === "lineAngle" && c.line === lineId) ??
    ({
      id: newId("c"),
      type: "lineAngle",
      line: lineId,
      value: normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI),
    } satisfies SketchConstraint);
  const added = [length, angle].filter((c) => !constraints.includes(c));
  return {
    constraints: withoutAxisLocks([...constraints, ...added]),
    lengthId: length.id,
    angleId: angle.id,
  };
}

export function dimensionValue(
  c: SketchConstraint,
  text: string,
): number | null {
  const v = Number(text);
  if (!text.trim() || !Number.isFinite(v)) return null;
  if (c.type === "lineAngle") return normalizeDegrees(v);
  return v > 0 ? v : null;
}
