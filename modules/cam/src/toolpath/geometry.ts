import {
  EndType,
  FillRule,
  JoinType,
  difference,
  inflatePaths,
  type Paths64,
} from "clipper2-ts";

export type Loop = { x: number; y: number }[];

const UNITS_PER_MM = 10_000;

function toClipper(loops: Loop[]): Paths64 {
  return loops.map((loop) =>
    loop.map(({ x, y }) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new RangeError(`loop point (${x}, ${y}) is not finite`);
      }
      return {
        x: Math.round(x * UNITS_PER_MM),
        y: Math.round(y * UNITS_PER_MM),
      };
    }),
  );
}

function fromClipper(paths: Paths64): Loop[] {
  return paths.map((path) =>
    path.map(({ x, y }) => ({ x: x / UNITS_PER_MM, y: y / UNITS_PER_MM })),
  );
}

export function offsetLoops(loops: Loop[], distance: number): Loop[] {
  return fromClipper(
    inflatePaths(
      toClipper(loops),
      distance * UNITS_PER_MM,
      JoinType.Round,
      EndType.Polygon,
    ),
  );
}

export function subtractLoops(subject: Loop[], clip: Loop[]): Loop[] {
  return fromClipper(
    difference(toClipper(subject), toClipper(clip), FillRule.NonZero),
  );
}
