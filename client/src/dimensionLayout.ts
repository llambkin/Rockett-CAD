import type { SketchConstraint } from "@rockett/shared";

type Point = { x: number; y: number };

/** Label placement and its attachment to measured geometry are distinct. */
export function dimensionLayout(
  constraint: SketchConstraint,
  points: Map<string, Point>,
  lines: Map<string, { p1: string; p2: string }>,
  circles: Map<string, { center: string; radius: number }>,
): { label: Point; attachment: Point } | null {
  const span = (a?: Point, b?: Point, offset = 2.5) => {
    if (!a || !b) return null;
    const attachment = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      attachment,
      label: { x: attachment.x - dy / length * offset, y: attachment.y + dx / length * offset },
    };
  };
  switch (constraint.type) {
    case "length":
    case "angle": {
      const line = lines.get(constraint.type === "length" ? constraint.line : constraint.a);
      return line ? span(points.get(line.p1), points.get(line.p2), constraint.type === "angle" ? 4 : 2.5) : null;
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
        label: { x: center.x + circle.radius * 0.75, y: center.y + circle.radius * 0.75 },
        attachment: { x: center.x + circle.radius * Math.SQRT1_2, y: center.y + circle.radius * Math.SQRT1_2 },
      };
    }
    default:
      return null;
  }
}
