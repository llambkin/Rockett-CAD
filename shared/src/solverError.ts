import type { SketchConstraint } from "./model.js";
import { ValidationError } from "./schema/index.js";
import { formatAngle, formatLength } from "./units.js";

const constraintName = (c: SketchConstraint): string => {
  const words = c.type.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  if (!("value" in c)) return name;
  const angle = c.type === "angle" || c.type === "lineAngle";
  return `${name} ${angle ? formatAngle(c.value, 3) : formatLength(c.value, "mm")}`;
};

export class OverConstrainedError extends ValidationError {
  constructor(readonly constraint: SketchConstraint) {
    super(`${constraintName(constraint)} would over-constrain the sketch.`);
  }
}

export class SolverModelError extends Error {}
