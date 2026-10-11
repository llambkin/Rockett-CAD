import { bsplineParams, bsplinePoint, type Spline } from "./bspline.js";
import { ARC_SEGMENTS, least } from "./curveSampling.js";
import type {
  SketchEllipse,
  SketchEntity,
  SketchFitSpline,
  SketchSpline,
} from "./model.js";
import {
  crossingIds,
  curveDistance,
  ELLIPSE_UNSUPPORTED,
  onRound,
  sketchCurves,
  SPLIT_TOL,
  type Curve,
  type XY,
} from "./sketchCurves.js";
import { LINEAR_TOL } from "./tolerance.js";

export const SPLINE_UNSUPPORTED = "This tool does not support splines yet.";
export const CONTACT_UNSUPPORTED =
  "This tool does not support curves that touch ellipses or splines yet.";

type Unsupported = SketchEllipse | SketchSpline | SketchFitSpline;

export const unsupported = (e: SketchEntity | undefined): e is Unsupported =>
  e?.kind === "ellipse" || e?.kind === "spline" || e?.kind === "fitSpline";

export const refusal = (e: Unsupported) =>
  e.kind === "ellipse" ? ELLIPSE_UNSUPPORTED : SPLINE_UNSUPPORTED;

export function refuseUnsupported<E extends SketchEntity>(
  e: E,
): asserts e is Exclude<E, Unsupported> {
  if (unsupported(e)) throw new Error(refusal(e));
}

export function endsOf(c: Curve): XY[] {
  switch (c.kind) {
    case "line":
      return [
        [c.x1, c.y1],
        [c.x2, c.y2],
      ];
    case "arc":
      return [c.s, c.e];
    case "circle":
      return [];
    case "ellipse":
      return c.span ? [c.span.s, c.span.e] : [];
    case "spline": {
      const [[x, y], [ex, ey]] = [c.poles[0]!, c.poles.at(-1)!];
      const closed = c.periodic || Math.hypot(ex - x, ey - y) < LINEAR_TOL;
      return closed ? [] : [c.poles[0]!, c.poles.at(-1)!];
    }
  }
}

function box(c: Curve): [number, number, number, number] {
  const corners: XY[] =
    c.kind === "spline"
      ? c.poles
      : c.kind === "line"
        ? endsOf(c)
        : [-1, 1].map((k): XY => {
            const r = c.kind === "ellipse" ? c.a : c.r;
            return [c.cx + k * r, c.cy + k * r];
          });
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const apart = (a: number[], b: number[]) =>
  a[0]! > b[2]! + SPLIT_TOL ||
  b[0]! > a[2]! + SPLIT_TOL ||
  a[1]! > b[3]! + SPLIT_TOL ||
  b[1]! > a[3]! + SPLIT_TOL;

function gapTo(c: Curve): (p: XY) => number {
  if (c.kind !== "arc") return ([x, y]) => curveDistance(c, x, y);
  return ([x, y]) =>
    onRound(c, x, y)
      ? curveDistance(c, x, y)
      : Math.min(...endsOf(c).map(([ex, ey]) => Math.hypot(x - ex, y - ey)));
}

function touches(s: Spline, c: Curve): boolean {
  if (apart(box(s), box(c))) return false;
  const gap = gapTo(c);
  const g = (u: number) => gap(bsplinePoint(s, u));
  const us = bsplineParams(s, ARC_SEGMENTS);
  const gs = us.map(g);
  const ends = endsOf(s);
  return gs.some((v, i) => {
    if (v > (gs[i - 1] ?? Infinity) || v > (gs[i + 1] ?? Infinity))
      return false;
    const found = least(g, us[i - 1] ?? us[i]!, us[i + 1] ?? us[i]!);
    const u = g(found) < v ? found : us[i]!;
    const [x, y] = bsplinePoint(s, u);
    return (
      g(u) <= SPLIT_TOL &&
      ends.every(([ex, ey]) => Math.hypot(x - ex, y - ey) > SPLIT_TOL)
    );
  });
}

export function crossingCurves(curves: Curve[], lines = false): Set<string> {
  const out = crossingIds(curves, lines);
  for (const s of curves) {
    if (s.kind !== "spline") continue;
    for (const c of curves)
      if (c !== s && touches(s, c)) out.add(s.id).add(c.id);
  }
  return out;
}

const CONTACT = {
  ellipse: ["Ellipse", "touches another curve"],
  spline: ["Spline", "touches another curve away from its end poles"],
} as const;

function crossingOf(curves: Curve[]): Map<"ellipse" | "spline", string[]> {
  const crossing = crossingCurves(curves);
  const out = new Map<"ellipse" | "spline", string[]>();
  for (const c of curves)
    if ((c.kind === "ellipse" || c.kind === "spline") && crossing.has(c.id))
      out.set(c.kind, [...(out.get(c.kind) ?? []), c.id]);
  return out;
}

export const crossingEllipses = (entities: SketchEntity[]) =>
  crossingOf(sketchCurves(entities)).get("ellipse") ?? [];

export function regionWarning(entities: SketchEntity[]): string | undefined {
  const lines = [...crossingOf(sketchCurves(entities))].map(
    ([kind, ids]) =>
      `${CONTACT[kind][0]} ${ids.join(", ")} ${CONTACT[kind][1]} and forms no region. Move it clear to use it.`,
  );
  return lines.length ? lines.join(" ") : undefined;
}
