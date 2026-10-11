import type { SketchConstraint, SketchEntity } from "@rockett/shared";

type Point = { x: number; y: number };

export function dimensionMaps(entities: SketchEntity[]) {
  const points = new Map<string, Point>();
  const lines = new Map<string, { p1: string; p2: string }>();
  const circles = new Map<string, { center: string; radius: number }>();
  for (const e of entities) {
    if (e.kind === "point") points.set(e.id, e);
    else if (e.kind === "line") lines.set(e.id, e);
    else if (e.kind === "circle") circles.set(e.id, e);
  }
  for (const e of entities) {
    const center = e.kind === "arc" && points.get(e.center);
    const start = e.kind === "arc" && points.get(e.start);
    if (center && start)
      circles.set(e.id, {
        center: e.center,
        radius: Math.hypot(start.x - center.x, start.y - center.y),
      });
  }
  return { points, lines, circles };
}

function span(a?: Point, b?: Point, offset = 2.5) {
  if (!a || !b) return null;
  const attachment = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    attachment,
    label: {
      x: attachment.x - (dy / length) * offset,
      y: attachment.y + (dx / length) * offset,
    },
  };
}

function foot(line: { a: Point; b: Point } | null, p?: Point) {
  if (!line || !p) return undefined;
  const dx = line.b.x - line.a.x,
    dy = line.b.y - line.a.y;
  const t =
    ((p.x - line.a.x) * dx + (p.y - line.a.y) * dy) / (dx * dx + dy * dy || 1);
  return { x: line.a.x + t * dx, y: line.a.y + t * dy };
}

/** Label placement and its attachment to measured geometry are distinct. */
export function dimensionLayout(
  constraint: SketchConstraint,
  points: Map<string, Point>,
  lines: Map<string, { p1: string; p2: string }>,
  circles: Map<string, { center: string; radius: number }>,
): { label: Point; attachment: Point; reference?: [Point, Point] } | null {
  const ends = (id: string) => {
    const line = lines.get(id);
    const a = line && points.get(line.p1);
    const b = line && points.get(line.p2);
    return a && b ? { a, b } : null;
  };
  switch (constraint.type) {
    case "length":
    case "angle": {
      const angle = constraint.type === "angle";
      const line = ends(angle ? constraint.a : constraint.line);
      return line && span(line.a, line.b, angle ? 4 : 2.5);
    }
    case "lineAngle": {
      const line = ends(constraint.line);
      if (!line) return null;
      const { a: start, b: end } = line;
      const dx = end.x - start.x,
        dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const base = constraint.axis === "y" ? Math.PI / 2 : 0;
      const turn = Math.atan2(dy, dx) - base;
      const half = base + Math.atan2(Math.sin(turn), Math.cos(turn)) / 2;
      const bisector = {
        x: start.x + (length / 3) * Math.cos(half),
        y: start.y + (length / 3) * Math.sin(half),
      };
      return {
        attachment: bisector,
        label: { ...bisector },
        reference: [
          { x: start.x, y: start.y },
          {
            x: start.x + (length / 2) * Math.cos(base),
            y: start.y + (length / 2) * Math.sin(base),
          },
        ],
      };
    }
    case "pointLineDistance": {
      const p = points.get(constraint.point);
      return span(p, foot(ends(constraint.line), p));
    }
    case "lineDistance": {
      const a = ends(constraint.a);
      const mid = a
        ? { x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 }
        : undefined;
      return span(mid, foot(ends(constraint.b), mid));
    }
    case "distance":
      return span(points.get(constraint.a), points.get(constraint.b));
    case "radius":
    case "diameter": {
      const circle = circles.get(constraint.entity);
      const center = circle && points.get(circle.center);
      if (!circle || !center) return null;
      return {
        // Preserve the existing default label location and saved offsets.
        label: {
          x: center.x + circle.radius * 0.75,
          y: center.y + circle.radius * 0.75,
        },
        attachment: {
          x: center.x + circle.radius * Math.SQRT1_2,
          y: center.y + circle.radius * Math.SQRT1_2,
        },
      };
    }
    default:
      return null;
  }
}
