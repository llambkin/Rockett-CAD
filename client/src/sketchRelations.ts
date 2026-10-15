import {
  newId,
  type SketchConstraint,
  type SketchEntity,
} from "@rockett/shared";
import type { IconId } from "./icons";
import type { Selection } from "./store";

export type RelationType =
  | "horizontal"
  | "vertical"
  | "coincident"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "equal"
  | "concentric"
  | "midpoint"
  | "collinear"
  | "fix";

export const CONSTRAINTS: Array<{
  type: RelationType & IconId;
  label: string;
  title: string;
}> = [
  { type: "horizontal", label: "Horizontal", title: "Horizontal" },
  { type: "vertical", label: "Vertical", title: "Vertical" },
  {
    type: "coincident",
    label: "Coincident",
    title: "Coincident (2 points, or a point on a line, circle or arc)",
  },
  { type: "parallel", label: "Parallel", title: "Parallel (2 lines)" },
  {
    type: "perpendicular",
    label: "Perpendicular",
    title: "Perpendicular (2 lines)",
  },
  { type: "tangent", label: "Tangent", title: "Tangent (line + circle)" },
  { type: "equal", label: "Equal", title: "Equal (2 lines / 2 circles)" },
  {
    type: "concentric",
    label: "Concentric",
    title: "Concentric (2 circles/arcs)",
  },
  { type: "midpoint", label: "Midpoint", title: "Midpoint (point + line)" },
  { type: "collinear", label: "Collinear", title: "Collinear (2 lines)" },
  { type: "fix", label: "Fix", title: "Fix point" },
];

type Draft = { entities: SketchEntity[]; constraints: SketchConstraint[] };

export type Relation = {
  type: RelationType;
  label: string;
  constraints: SketchConstraint[];
};

export function sketchSelectionIds(selection: Selection[]): string[] {
  return selection.flatMap((s) =>
    s.kind === "sketchEntity" || s.kind === "sketchPoint" ? [s.entityId] : [],
  );
}

function classify(draft: Draft, ids: string[]) {
  const find = (id: string | undefined) =>
    draft.entities.find((e) => e.id === id);
  const own = (curve: string) => {
    const e = find(curve);
    if (e?.kind === "line") return [e.p1, e.p2];
    if (e?.kind === "circle") return [e.center];
    if (e?.kind === "arc") return [e.center, e.start, e.end];
    return [];
  };
  return {
    find,
    own,
    points: ids.filter((id) => find(id)?.kind === "point"),
    lines: ids.filter((id) => find(id)?.kind === "line"),
    circleLikes: ids.filter((id) => {
      const k = find(id)?.kind;
      return k === "circle" || k === "arc";
    }),
  };
}

export function constraintFor(
  draft: Draft,
  ids: string[],
  type: RelationType,
): SketchConstraint | null {
  const { find, own, points, lines, circleLikes } = classify(draft, ids);
  const [point, point2] = points;
  const [line, line2] = lines;
  const [circle, circle2] = circleLikes;
  const id = newId("c");
  switch (type) {
    case "horizontal":
    case "vertical":
      return line ? { id, type, line } : null;
    case "coincident": {
      const at = (p: string) => {
        const e = find(p);
        return e?.kind === "point" ? e : { x: NaN, y: NaN };
      };
      const offCurve = (p: string) => {
        const e = find(circle);
        if (e?.kind !== "circle" && e?.kind !== "arc") return Infinity;
        const o = at(e.center);
        const r =
          e.kind === "circle"
            ? e.radius
            : Math.hypot(at(e.start).x - o.x, at(e.start).y - o.y);
        return Math.abs(Math.hypot(at(p).x - o.x, at(p).y - o.y) - r);
      };
      if (point && point2) return { id, type, a: point, b: point2 };
      if (point && circle && !own(circle).includes(point))
        return { id, type: "pointOnCircle", point, circle };
      if (point && line && !own(line).includes(point))
        return { id, type: "pointOnLine", point, line };
      if (point || !line || !circle) return null;
      const end = own(line).reduce((a, b) =>
        offCurve(b) < offCurve(a) ? b : a,
      );
      return own(circle).includes(end)
        ? null
        : { id, type: "pointOnCircle", point: end, circle };
    }
    case "parallel":
    case "perpendicular":
    case "collinear":
      return line && line2 ? { id, type, a: line, b: line2 } : null;
    case "tangent":
      if (line && circle) return { id, type, a: line, b: circle };
      return circle && circle2 ? { id, type, a: circle, b: circle2 } : null;
    case "equal":
      if (line && line2) return { id, type, a: line, b: line2 };
      return circle && circle2 ? { id, type, a: circle, b: circle2 } : null;
    case "concentric":
      return circle && circle2 ? { id, type, a: circle, b: circle2 } : null;
    case "midpoint":
      return point && line ? { id, type, point, line } : null;
    case "fix":
      return point ? { id, type, point } : null;
  }
}

const WHOLE: Record<
  Exclude<RelationType, "horizontal" | "vertical">,
  string[]
> = {
  coincident: ["2,0,0", "1,1,0", "1,0,1", "0,1,1"],
  parallel: ["0,2,0"],
  perpendicular: ["0,2,0"],
  collinear: ["0,2,0"],
  tangent: ["0,1,1", "0,0,2"],
  equal: ["0,2,0", "0,0,2"],
  concentric: ["0,0,2"],
  midpoint: ["1,1,0"],
  fix: ["1,0,0"],
};

const refs = (c: SketchConstraint) =>
  JSON.stringify([
    c.type,
    Object.entries(c)
      .filter(([k]) => k !== "id" && k !== "type" && k !== "labelOffset")
      .map(([, v]) => v)
      .toSorted(),
  ]);

export function relationsFor(draft: Draft, ids: string[]): Relation[] {
  const { own, points, lines, circleLikes } = classify(draft, ids);
  if (ids.length === 0) return [];
  if (points.length + lines.length + circleLikes.length !== ids.length)
    return [];
  const counts = `${points.length},${lines.length},${circleLikes.length}`;
  const existing = new Set(draft.constraints.map(refs));
  const fresh = (c: SketchConstraint | null) => c && !existing.has(refs(c));
  return CONSTRAINTS.flatMap(({ type, label }): Relation[] => {
    if (type === "horizontal" || type === "vertical") {
      if (lines.length !== ids.length) return [];
      if (
        draft.constraints.some(
          (c) =>
            (c.type === "horizontal" || c.type === "vertical") &&
            c.type !== type &&
            lines.includes(c.line),
        )
      )
        return [];
      const constraints = lines
        .map((line) => constraintFor(draft, [line], type))
        .filter(fresh) as SketchConstraint[];
      return constraints.length ? [{ type, label, constraints }] : [];
    }
    if (!WHOLE[type].includes(counts)) return [];
    const [point] = points;
    const [line] = lines;
    if (type === "midpoint" && point && line && own(line).includes(point))
      return [];
    const c = constraintFor(draft, ids, type);
    return fresh(c) ? [{ type, label, constraints: [c!] }] : [];
  });
}
