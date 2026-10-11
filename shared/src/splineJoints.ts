import type {
  SketchConstraint,
  SketchEntity,
  SketchFitSpline,
  SketchSpline,
} from "./model.js";

type SplineLike = SketchSpline | SketchFitSpline;
type Pair = [string, string];

export type SplineJoint = {
  end: Pair;
  other: Pair;
  radial: boolean;
  curves: Pair;
};

export const SMOOTH_NEEDS =
  "smooth needs a spline and the line, arc or spline at its end";

export const splineLike = (e: SketchEntity | undefined): e is SplineLike =>
  e?.kind === "spline" || e?.kind === "fitSpline";

export function splineEnds(e: SplineLike): Pair[] {
  if (e.kind === "fitSpline")
    return [
      [e.points[0]!, e.handles[0]],
      [e.points.at(-1)!, e.handles[1]],
    ];
  if (e.periodic || e.poles.length < 2) return [];
  return [
    [e.poles[0]!, e.poles[1]!],
    [e.poles.at(-1)!, e.poles.at(-2)!],
  ];
}

function jointAt(
  o: SketchEntity | undefined,
  same: (id: string) => boolean,
): Omit<SplineJoint, "end" | "curves"> | undefined {
  if (o?.kind === "line") {
    if (same(o.p1)) return { other: [o.p1, o.p2], radial: false };
    if (same(o.p2)) return { other: [o.p2, o.p1], radial: false };
  }
  if (o?.kind === "arc") {
    const at = [o.start, o.end].find(same);
    if (at) return { other: [o.center, at], radial: true };
  }
  if (!splineLike(o)) return undefined;
  const hit = splineEnds(o).find(([p]) => same(p));
  return hit && { other: hit, radial: false };
}

export function splineTangent(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  c: { type: string; a: string; b: string },
): SplineJoint | string | undefined {
  const find = (id: string) => entities.find((e) => e.id === id);
  const [a, b] = [find(c.a), find(c.b)];
  const spline = splineLike(a) ? a : splineLike(b) ? b : undefined;
  if (!spline) return undefined;
  const other = spline === a ? b : a;
  const linked = (p: string) => (q: string) =>
    p === q ||
    constraints.some(
      (k) =>
        k.type === "coincident" &&
        ((k.a === p && k.b === q) || (k.a === q && k.b === p)),
    );
  for (const end of splineEnds(spline)) {
    const joint = other !== spline && jointAt(other, linked(end[0]));
    if (joint) return { end, ...joint, curves: [spline.id, other!.id] };
  }
  return `${c.type} constraints on ${spline.kind} ${spline.id} need a shared end with a line, arc or spline`;
}
