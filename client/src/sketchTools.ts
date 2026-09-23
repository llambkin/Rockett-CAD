/**
 * Sketch tool geometry builders — pure functions that turn tool clicks into
 * entities + constraints. Interaction state lives in the viewport component.
 */

import type { SketchConstraint, SketchEntity } from "@rockett/shared";
import { newId, normalizeDegrees } from "@rockett/shared";

export interface Created {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  /** ids of points that can keep being chained (line tool) */
  chainPointId?: string;
}

export interface UV {
  x: number;
  y: number;
  /** id of an existing point snapped to, if any */
  snapPointId?: string | undefined;
  /** id of a line the click snapped onto (adds pointOnLine) */
  snapLineId?: string | undefined;
  /** id of a circle/arc the click snapped onto (adds pointOnCircle) */
  snapCircleId?: string | undefined;
  /** id of a line whose midpoint the click snapped to (adds midpoint) */
  snapMidLineId?: string | undefined;
  /** id of a connected line the new line snapped perpendicular to (adds perpendicular) */
  snapPerpLineId?: string | undefined;
  /** what kind of snap engaged (drives the on-screen snap glyph) */
  snapKind?: "point" | "midpoint" | "curve" | "origin" | "perpendicular";
}

/**
 * Where the ray from `A` along `r` meets the segment `a→b` (extended by
 * `slack` beyond each end), or null when parallel or behind the ray's start.
 * Used to land a direction-locked line (axis / perpendicular snap) exactly on
 * the curve it is being snapped to instead of merely near it.
 */
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

/** Half-width of the band (degrees) in which a line snaps to 90° from a connected line. */
export const PERP_SNAP_DEG = 4;

/**
 * Perpendicular inference for the line tool: when the line being drawn from
 * `from` towards `cursor` is within PERP_SNAP_DEG of a right angle to a line
 * that ends at `from`, rotate it onto the exact perpendicular (length kept).
 * Returns null when nothing is close enough, or the line is too short to have
 * a meaningful direction (`minLen`). Reference lines are found by the shared
 * point id, or by an endpoint coinciding with `from`.
 *
 * Axis-aligned results are made exact so createLine's horizontal/vertical
 * auto-constraint fires instead of a perpendicular one (which would be
 * redundant next to a horizontal/vertical reference line).
 */
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
    // |cos| of the angle between the two lines = sin of the deviation from 90°
    const off = Math.abs((dx * lx + dy * ly) / len);
    if (off < maxSin && (!best || off < best.off))
      best = { lineId: e.id, off, lx, ly };
  }
  if (!best) return null;
  // perpendicular direction, on the cursor's side
  const nx = -best.ly;
  const ny = best.lx;
  const sgn = dx * nx + dy * ny < 0 ? -1 : 1;
  const axisTol = 1e-9;
  if (Math.abs(best.lx) < axisTol) {
    // reference is vertical → new line exactly horizontal
    return {
      x: from.x + (dx < 0 ? -len : len),
      y: from.y,
      snapKind: "perpendicular",
    };
  }
  if (Math.abs(best.ly) < axisTol) {
    // reference is horizontal → new line exactly vertical
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

function pointOrExisting(
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
      // Face corners/midpoints and the origin have no sketch entity to
      // constrain against. Preserve their snapped position during solving.
      // Sketch references above retain their relational constraints instead.
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
  // Auto-constrain lines drawn exactly axis-aligned (alignment snapping
  // produces exact coordinates; freehand clicks never coincide exactly).
  if (a.x === b.x && a.y !== b.y) {
    constraints.push({ id: newId("c"), type: "vertical", line: lineId });
  } else if (a.y === b.y && a.x !== b.x) {
    constraints.push({ id: newId("c"), type: "horizontal", line: lineId });
  } else if (b.snapPerpLineId) {
    // snapped to 90° from a connected line: keep it that way
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

/** 3-point arc: start, end, then a point on the arc. */
export function createArc3(start: UV, end: UV, on: UV): Created | null {
  // circumcenter of the three points
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
  // arc goes CCW from start to end; flip when the on-point lies the other way
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

export function createPolygon(center: UV, vertex: UV, sides: number): Created {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const r = Math.hypot(vertex.x - center.x, vertex.y - center.y);
  const a0 = Math.atan2(vertex.y - center.y, vertex.x - center.x);
  const pointIds: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i / sides) * Math.PI * 2;
    const id = newId("pt");
    entities.push({
      id,
      kind: "point",
      x: center.x + r * Math.cos(a),
      y: center.y + r * Math.sin(a),
    });
    pointIds.push(id);
  }
  const lineIds: string[] = [];
  for (let i = 0; i < sides; i++) {
    const id = newId("ln");
    entities.push({
      id,
      kind: "line",
      p1: pointIds[i]!,
      p2: pointIds[(i + 1) % sides]!,
    });
    lineIds.push(id);
  }
  for (let i = 1; i < sides; i++) {
    constraints.push({
      id: newId("c"),
      type: "equal",
      a: lineIds[0]!,
      b: lineIds[i]!,
    });
  }
  return { entities, constraints };
}

/** Slot: two center clicks + a radius from the second click drag point. */
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
  // arc at c2 from b1 to b2 (ccw), arc at c1 from a2 to a1
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

/**
 * Build the right dimensional constraint for the current selection.
 * Returns null when the selection doesn't support a dimension.
 */
export function dimensionFor(
  targets: Array<
    | { kind: "point"; id: string }
    | { kind: "line"; id: string }
    | { kind: "circle"; id: string }
    | { kind: "arc"; id: string }
  >,
  value: number,
): SketchConstraint | null {
  if (targets.length === 1) {
    const t = targets[0]!;
    if (t.kind === "line") {
      return { id: newId("c"), type: "length", line: t.id, value };
    }
    if (t.kind === "circle" || t.kind === "arc") {
      return { id: newId("c"), type: "diameter", entity: t.id, value };
    }
    return null;
  }
  if (targets.length === 2) {
    const a = targets[0]!;
    const b = targets[1]!;
    if (a.kind === "point" && b.kind === "point") {
      return {
        id: newId("c"),
        type: "distance",
        a: a.id,
        b: b.id,
        axis: null,
        value,
      };
    }
    if (a.kind === "line" && b.kind === "line") {
      return { id: newId("c"), type: "angle", a: a.id, b: b.id, value };
    }
  }
  return null;
}

/**
 * Mark everything a tool just created as construction geometry (points and
 * curves alike) so any tool — rectangle, circle, polygon, slot… — can draw
 * reference geometry, not only the line tool. Existing snapped-to points are
 * not in `created.entities` and stay as they are.
 */
export function asConstruction(created: Created): Created {
  return {
    ...created,
    entities: created.entities.map((e) => ({ ...e, construction: true })),
  };
}

/**
 * Identity of a dimensional constraint by what it measures (not its id or
 * value): two dimensions with the same key drive the same size and can only
 * fight each other. Non-dimensional constraints return null.
 */
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
      return `distance:${[x.a, x.b].sort().join("|")}:${x.axis ?? ""}`;
    case "angle":
      return `angle:${[x.a, x.b].sort().join("|")}`;
    default:
      return null;
  }
}

/** The existing dimension measuring the same thing as `candidate`, if any. */
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

/**
 * Drop dimensions that duplicate another one on the same target. The
 * constraint with id `keepId` (the one just edited) always survives;
 * otherwise the first occurrence wins. Order is preserved.
 */
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

// ---------------------------------------------------------------------------
// Typed sizes while drawing (Fusion-style): the viewport shows one field per
// size; a typed value locks its field and overrides the cursor when placing.
// ---------------------------------------------------------------------------

export type DimKey = "length" | "angle" | "width" | "height" | "diameter";

export interface DimField {
  key: DimKey;
  label: string;
  unit: string;
  /** shown text: live cursor value until typed, then what the user typed */
  text: string;
  locked: boolean;
}

export function fmt2(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Which sizes a tool exposes for typing; null = readout only. */
export function dimFieldsFor(tool: string): DimField[] | null {
  const f = (key: DimKey, label: string, unit: string): DimField => ({
    key,
    label,
    unit,
    text: "",
    locked: false,
  });
  switch (tool) {
    case "line":
      return [f("length", "L", "mm"), f("angle", "∠", "°")];
    case "rect":
    case "centerRect":
      return [f("width", "W", "mm"), f("height", "H", "mm")];
    case "circle":
      return [f("diameter", "⌀", "mm")];
    default:
      return null;
  }
}

/** Sizes implied by the cursor, for the fields the user hasn't typed. */
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

/** Typed value of a field, or null when it's unlocked / not a usable number. */
export function lockedValue(fields: DimField[], key: DimKey): number | null {
  const f = fields.find((x) => x.key === key);
  if (!f?.locked) return null;
  const v = parseFloat(f.text);
  if (!Number.isFinite(v)) return null;
  return key === "angle" || v > 0 ? v : null;
}

/**
 * Where the shape's second input effectively is: the cursor, overridden per
 * axis by locked sizes. Axis-aligned results are computed exactly so
 * createLine's horizontal/vertical auto-constraints still fire. Point/curve
 * snap ids are dropped once a size is typed — snapping would fight the
 * number; a perpendicular snap survives a typed length (same direction) but
 * not a typed angle.
 */
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
  const sgn = (v: number) => (v < 0 ? -1 : 1);
  switch (tool) {
    case "line": {
      const L = lockedValue(fields, "length");
      const A = lockedValue(fields, "angle");
      if (L === null && A === null) return c;
      const length = L ?? len;
      if (A === null) {
        // direction untouched, so a perpendicular snap stays valid
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

export const ANGLE_SNAP_STEP = 15;

export function snapAngle(deg: number, step: number): number {
  return Math.round(deg / step) * step;
}

export function snapLineEnd(a: UV, c: UV): UV {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { x: c.x, y: c.y };
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return pointAtAngle(a, length, snapAngle(deg, ANGLE_SNAP_STEP));
}

export function toggleAngleLock(fields: DimField[], live: number): void {
  const f = fields.find((x) => x.key === "angle");
  if (!f) return;
  f.locked = !f.locked;
  f.text = fmt2(live);
}

/** Dimension constraints that pin the typed sizes onto the created geometry. */
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
    // createRect order: l1 = first horizontal side, l2 = first vertical side
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
