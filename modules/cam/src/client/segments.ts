import { expandArc } from "../post/normalise.js";
import type { Program, Xyz } from "../shared/ir.js";

export const ROLES = ["rapid", "cut", "plunge", "link"] as const;
export type SegmentRole = (typeof ROLES)[number];

const CHORD_ERROR = 0.01;

export type Segments = {
  positions: Float32Array;
  roles: Uint8Array;
  moveEnds: Uint32Array;
  sections: { operationId: string; start: number; count: number }[];
};

export function programToSegments(program: Program): Segments {
  const points: number[] = [];
  const roles: number[] = [];
  const moveEnds: number[] = [];
  const sections: Segments["sections"] = [];
  let at: Xyz | undefined;
  const add = (to: Xyz, role: SegmentRole) => {
    if (at) {
      const index = ROLES.indexOf(role);
      points.push(...at, ...to);
      roles.push(index, index);
    }
    at = to;
  };
  for (const { operationId, moves } of program.sections) {
    const start = roles.length;
    for (const move of moves) {
      if (move.kind === "cycle")
        throw new Error("drill cycles are not drawn yet");
      if (move.kind === "rapid") add(move.to, "rapid");
      else if (move.kind === "feed") add(move.to, move.role);
      else if (move.kind !== "arc") continue;
      else if (!at) add(move.to, move.role);
      else
        for (const { to } of expandArc(at, move, CHORD_ERROR))
          add(to, move.role);
      moveEnds.push(roles.length);
    }
    sections.push({ operationId, start, count: roles.length - start });
  }
  return {
    positions: Float32Array.from(points),
    roles: Uint8Array.from(roles),
    moveEnds: Uint32Array.from(moveEnds),
    sections,
  };
}
