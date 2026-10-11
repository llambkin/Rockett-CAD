import {
  conicSpline,
  curveSamples,
  interpolateFit,
  LINEAR_TOL,
  newId,
  sketchCurves,
  splineProblem,
  type SketchConstraint,
  type SketchEntity,
} from "@rockett/shared";
import { sketchSelectionIds } from "./sketchRelations";
import { pointOrExisting, type Created, type UV } from "./sketchTools";
import { useStore } from "./store";

type XY = [number, number];

const xy = (p: UV): XY => [p.x, p.y];
const gap = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const distinctClicks = (clicks: UV[]): UV[] =>
  clicks.filter(
    (c, i) => i === 0 || gap(xy(c), xy(clicks[i - 1]!)) > LINEAR_TOL,
  );

function endSlope(q: XY[], t: number[]): XY {
  const [t1, t2] = [t[1]!, t[2]!];
  const k = [
    -(t1 + t2) / (t1 * t2),
    t2 / (t1 * (t2 - t1)),
    -t1 / (t2 * (t2 - t1)),
  ];
  return [0, 1].map((i) => k.reduce((s, w, j) => s + w * q[j]![i]!, 0)) as XY;
}

function handleFrom(q: XY[]): XY {
  if (q.length < 3)
    return [
      q[0]![0] + (q[1]![0] - q[0]![0]) / 3,
      q[0]![1] + (q[1]![1] - q[0]![1]) / 3,
    ];
  const t = [0, gap(q[0]!, q[1]!)];
  t.push(t[1]! + gap(q[1]!, q[2]!));
  const d = endSlope(q, t);
  return [q[0]![0] + (d[0] * t[1]!) / 3, q[0]![1] + (d[1] * t[1]!) / 3];
}

function defaultHandles(fit: XY[]): [XY, XY] {
  return [handleFrom(fit), handleFrom(fit.toReversed())];
}

function points(clicks: UV[], construction: boolean | undefined) {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const ids = clicks.map((c) =>
    pointOrExisting(c, construction, entities, constraints),
  );
  return { entities, constraints, ids };
}

export function createFitSpline(clicks: UV[]): Created | null {
  const fit = distinctClicks(clicks);
  if (fit.length < 2) return null;
  const at = fit.map(xy);
  const handles = defaultHandles(at);
  if (typeof interpolateFit(at, handles) === "string") return null;
  const made = points(fit, undefined);
  const ends = handles.map(([x, y]) => {
    const id = newId("pt");
    made.entities.push({ id, kind: "point", x, y, construction: true });
    return id;
  }) as [string, string];
  made.entities.push({
    id: newId("sp"),
    kind: "fitSpline",
    points: made.ids,
    handles: ends,
  });
  return made;
}

export function createControlSpline(clicks: UV[]): Created | null {
  const poles = distinctClicks(clicks);
  if (poles.length < 2) return null;
  const degree = Math.min(3, poles.length - 1);
  const spans = poles.length - degree;
  const made = points(poles, undefined);
  made.entities.push({
    id: newId("sp"),
    kind: "spline",
    degree,
    poles: made.ids,
    knots: Array.from({ length: spans + 1 }, (_, i) => i),
    multiplicities: Array.from({ length: spans + 1 }, (_, i) =>
      i === 0 || i === spans ? degree + 1 : 1,
    ),
  });
  return made;
}

export function createConic(
  start: UV,
  end: UV,
  apex: UV,
  rho: number,
): Created | string {
  const problem = conicSpline(xy(start), xy(apex), xy(end), rho);
  if (typeof problem === "string") return `Conic: ${problem}`;
  const made = points([start, apex, end], undefined);
  made.entities.push({
    id: newId("cn"),
    kind: "spline",
    degree: 2,
    poles: made.ids,
    knots: [0, 1],
    multiplicities: [3, 3],
    rho,
  });
  return made;
}

export function splinePreview(
  tool: string,
  clicks: UV[],
  cursor: UV,
  rho: number,
): number[] {
  const plain = [...clicks, cursor].map(({ x, y }) => ({ x, y }));
  const [a, b, c] = plain;
  const made =
    tool === "fitSpline"
      ? createFitSpline(plain)
      : tool === "controlSpline"
        ? createControlSpline(plain)
        : a && b && c && createConic(a, b, c, rho);
  const curve =
    typeof made === "object" && made && sketchCurves(made.entities, true)[0];
  return curve ? curveSamples(curve, 64) : plain.flatMap((p) => [p.x, p.y]);
}

type State = ReturnType<typeof useStore.getState>;

export function selectedConic(s: State) {
  const ids = sketchSelectionIds(s.selection);
  const e =
    ids.length === 1 && s.draftSketch?.entities.find((x) => x.id === ids[0]);
  return e && e.kind === "spline" && e.rho !== undefined ? e : undefined;
}

export async function setConicRho(id: string, rho: number) {
  const s = useStore.getState();
  const draft = s.draftSketch;
  const conic = draft?.entities.find((e) => e.id === id);
  if (!draft || conic?.kind !== "spline") return;
  const byId = new Map(
    draft.entities.flatMap((e) =>
      e.kind === "point" ? [[e.id, e] as const] : [],
    ),
  );
  const problem = splineProblem({ ...conic, rho }, byId);
  if (problem) return s.setError(`Conic ${id}: ${problem}`);
  s.updateDraftSketch(
    draft.entities.map((e) => (e === conic ? { ...conic, rho } : e)),
    draft.constraints,
  );
  await s.commitDraftSketch();
}
