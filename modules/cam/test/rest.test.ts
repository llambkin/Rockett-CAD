import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateProgram,
  type Move,
  type Section,
  type Xyz,
} from "../src/shared/ir.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import {
  area,
  components,
  lines,
  offsetLoops,
  subtractLoops,
  swathOf,
  unionLoops,
  covers,
  type Loop,
} from "../src/toolpath/geometry.js";
import { pocket, provenCleared } from "../src/toolpath/pocket.js";
import {
  leftover,
  rest,
  restPrior,
  type Prior,
  type RestInput,
  type SetupOperation,
} from "../src/toolpath/rest.js";

const flat = (diameter: number): Tool => ({
  id: `t${diameter}`,
  name: `${diameter} mm flat`,
  kind: "flat",
  diameter,
  fluteLength: 22,
  overallLength: 50,
  shankDiameter: diameter,
  flutes: 2,
  centreCutting: true,
});

const preset: Preset = {
  id: "p1",
  name: "MDF rest",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off",
};

function rounded(w: number, h: number, r: number, n: number): Loop {
  const corners: [number, number, number][] = [
    [w - r, r, -Math.PI / 2],
    [w - r, h - r, 0],
    [r, h - r, Math.PI / 2],
    [r, r, Math.PI],
  ];
  return corners.flatMap(([cx, cy, start]) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const angle = start + (i / n) * (Math.PI / 2);
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }),
  );
}

const fine = rounded(40, 30, 2, 128);
const coarse = rounded(40, 30, 2, 32);
const corner = (25 - 4) * (1 - Math.PI / 4);

const bull = (diameter: number, cornerRadius: number): Tool => ({
  ...flat(diameter),
  id: `b${diameter}`,
  name: `${diameter} mm bull`,
  kind: "bull",
  cornerRadius,
});

const prior = (diameter: number, boundary = fine): Prior => ({
  operationId: `rough${diameter}`,
  tool: flat(diameter),
  preset,
  boundary,
  islands: [],
  bottom: -6,
});

const square = (x0: number, y0: number, x1: number, y1: number): Loop => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const input = (changes: Partial<RestInput> = {}): RestInput => ({
  operationId: "rest",
  setup: { safeHeight: 15, clearance: 3, fixtures: [] },
  stock: { min: [-10, -10, -10], max: [50, 40, 0] },
  boundary: coarse,
  islands: [],
  bottom: -6,
  rampAngle: 5,
  tool: flat(4),
  preset,
  prior: prior(10, coarse),
  ...changes,
});

const big = {
  min: [-10, -10, -10],
  max: [60, 60, 0],
} satisfies RestInput["stock"];

const areaOf = (loops: Loop[]) =>
  loops.reduce((sum, loop) => sum + area(lines(loop)), 0);

const sectionOf = (changes: Partial<RestInput> = {}) => {
  const made = rest(input(changes));
  if (!made.section) throw new Error(made.reason);
  return made.section;
};

const roughOf = (made: Prior) => pocket({ ...input(), ...made });

function* travel(moves: Move[]) {
  let at: Xyz | undefined;
  for (const move of moves) {
    if (move.kind !== "rapid" && move.kind !== "feed" && move.kind !== "arc")
      continue;
    if (at) yield { from: at, move };
    at = move.to;
  }
}

function path(from: Xyz, move: Move): Loop {
  if (move.kind !== "arc")
    return "to" in move
      ? [
          { x: from[0], y: from[1] },
          { x: move.to[0], y: move.to[1] },
        ]
      : [];
  const [cx, cy] = move.centre;
  const radius = Math.hypot(from[0] - cx, from[1] - cy);
  const start = Math.atan2(from[1] - cy, from[0] - cx);
  const end = Math.atan2(move.to[1] - cy, move.to[0] - cx);
  let turn = move.dir === "ccw" ? end - start : start - end;
  while (turn <= 1e-9) turn += 2 * Math.PI;
  const sign = move.dir === "ccw" ? 1 : -1;
  return Array.from({ length: 65 }, (_, i) => {
    const angle = start + (sign * turn * i) / 64;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function levelled(section: Section) {
  return [...travel(section.moves)].map(({ from, move }) =>
    move.kind !== "rapid" && from[2] === move.to[2]
      ? { from, move, z: from[2] }
      : undefined,
  );
}

function chained(section: Section, r: number) {
  const swaths: { z: number; loops: Loop[]; link?: number }[] = [];
  let chain: Loop = [];
  let at = 0;
  const flush = () => {
    if (chain.length) swaths.push({ z: at, loops: swathOf(chain, r) });
    chain = [];
  };
  const steps = levelled(section);
  for (const [i, step] of steps.entries()) {
    if (!step || step.move.role === "link") flush();
    if (!step) continue;
    if (step.move.role === "link") {
      swaths.push({ z: step.z, loops: [], link: i });
      continue;
    }
    const points = path(step.from, step.move);
    if (chain.length) chain.push(...points.slice(1));
    else [chain, at] = [points, step.z];
  }
  flush();
  return { swaths, steps };
}

function swept(section: Section, r: number, at: (z: number) => boolean) {
  return unionLoops(
    chained(section, r).swaths.flatMap(({ z, loops }) => (at(z) ? loops : [])),
  );
}

function links(section: Section, r: number, before: (z: number) => Loop[]) {
  const { swaths, steps } = chained(section, r);
  const cut = new Map<number, Loop[]>();
  const pending = new Map<number, Loop[]>();
  const found = [];
  for (const { z, loops, link } of swaths) {
    if (link === undefined) {
      pending.set(z, [...(pending.get(z) ?? []), ...loops]);
      continue;
    }
    const cleared = unionLoops([
      ...(cut.get(z) ?? before(z)),
      ...(pending.get(z) ?? []),
    ]);
    cut.set(z, cleared);
    pending.delete(z);
    const { from, move } = steps[link]!;
    const after = steps.slice(link + 1);
    const end = after.findIndex(
      (next) => !next || next.z !== z || next.move.role === "link",
    );
    found.push({
      swath: swathOf(path(from, move), r - 5e-3),
      cleared,
      ahead: (end < 0 ? after : after.slice(0, end)).flatMap((next) =>
        next ? swathOf(path(next.from, next.move), r) : [],
      ),
      length: Math.hypot(move.to[0] - from[0], move.to[1] - from[1]),
    });
  }
  return found;
}

describe("rest", () => {
  it("leaves four corners of (25 - 4)(1 - pi/4) mm2 after a 10 mm tool, and none after a 4 mm one", () => {
    const region = [fine];
    const corners = components(leftover(region, prior(10)));
    expect(corners).toHaveLength(4);
    for (const part of corners)
      expect(Math.abs(areaOf(part) - corner)).toBeLessThan(1e-3);
    expect(leftover(region, prior(4))).toEqual([]);
  });

  it("matches the golden IR for a 3 mm deep 4 mm rest after a 10 mm pocket", () => {
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/rest.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(sectionOf({ bottom: -3 })).toEqual(golden);
  });

  it("forms a valid program", () => {
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: "s1",
        offsetIndex: 1,
        tools: [{ ...flat(4), number: 1 }],
        sections: [sectionOf()],
      }),
    ).toEqual([]);
  });

  it("cuts all the leftover on the floor", () => {
    const swaths = swept(sectionOf(), 2, (z) => z === -6);
    const uncut = subtractLoops(leftover([coarse], prior(10, coarse)), swaths);
    expect(offsetLoops(uncut, -5e-3)).toEqual([]);
  });

  it("keeps every link inside area cleared at its depth, the prior's swaths included", () => {
    const rough = roughOf(prior(10, coarse));
    const found = links(sectionOf(), 2, (z) =>
      swept(rough, 5, (at) => at <= z),
    );
    for (const { swath, cleared } of found)
      expect(covers(cleared, swath)).toBe(true);
    expect(Math.max(...found.map(({ length }) => length))).toBeGreaterThan(20);
  });

  it("keeps floor links off the fillet a bull prior leaves", () => {
    const made = { ...prior(10, coarse), tool: bull(10, 2) };
    const rough = roughOf(made);
    const found = links(sectionOf({ prior: made }), 2, (z) =>
      z === -6
        ? swept(rough, 5 - 2, (at) => at === -6)
        : swept(rough, 5, (at) => at <= z),
    );
    expect(found.length).toBeGreaterThan(0);
    for (const { swath, cleared, ahead } of found)
      expect(covers(unionLoops([...cleared, ...ahead]), swath)).toBe(true);
  });

  it("cuts a neck the prior's radius opens but its tool centres never reach", () => {
    const boundary = square(0, 0, 30.002, 30.002);
    const islands = [square(10.001, 10.001, 20.001, 20.001)];
    const made: Prior = { ...prior(10, boundary), islands };
    const section = sectionOf({ boundary, islands, prior: made });
    const region = subtractLoops([boundary], islands);
    const uncut = subtractLoops(offsetLoops(offsetLoops(region, -2), 2), [
      ...provenCleared(region, 5),
      ...swept(section, 2, (z) => z === -6),
    ]);
    expect(offsetLoops(uncut, -5e-3)).toEqual([]);
  });

  it.each([
    ["no island, a 1 mm corner", [], 1],
    ["a 10 by 10 island, a 2 mm corner", [square(20, 20, 30, 30)], 2],
  ])(
    "clears the fillet of a bull prior on the floor of a 50 by 50 pocket, %s",
    (_, islands, cornerRadius) => {
      const boundary = square(0, 0, 50, 50);
      const made: Prior = {
        ...prior(10, boundary),
        islands,
        tool: bull(10, cornerRadius),
      };
      const rough = pocket({ ...input(), stock: big, ...made });
      const section = sectionOf({ stock: big, boundary, islands, prior: made });
      const region = subtractLoops([boundary], islands);
      const uncut = subtractLoops(offsetLoops(offsetLoops(region, -2), 2), [
        ...swept(rough, 5 - cornerRadius, (z) => z === -6),
        ...swept(section, 2, (z) => z === -6),
      ]);
      expect(offsetLoops(uncut, -5e-3)).toEqual([]);
      const found = links(section, 2, (z) =>
        z === -6
          ? swept(rough, 5 - cornerRadius, (at) => at === -6)
          : swept(rough, 5, (at) => at <= z),
      );
      for (const { swath, cleared, ahead } of found)
        expect(covers(unionLoops([...cleared, ...ahead]), swath)).toBe(true);
      const flatRest = sectionOf({
        stock: big,
        boundary,
        islands,
        prior: { ...made, tool: flat(10) },
      });
      const cuts = (cut: Section) =>
        levelled(cut).filter(
          (step) => step && step.z > -6 && step.move.role !== "link",
        );
      expect(cuts(section)).toEqual(cuts(flatRest));
    },
  );

  it("keeps the rest after a flat prior in a 50 by 50 pocket with a 10 by 10 island", () => {
    const boundary = square(0, 0, 50, 50);
    const islands = [square(20, 20, 30, 30)];
    const section = sectionOf({
      stock: big,
      boundary,
      islands,
      prior: { ...prior(10, boundary), islands },
    });
    expect(section.moves.filter(({ kind }) => kind === "feed")).toHaveLength(
      1616,
    );
  });

  it("emits no section when a bull prior leaves only its fillet below the rest floor", () => {
    const boundary = rounded(40, 30, 6, 128);
    const made = { ...prior(10, boundary), tool: bull(10, 2) };
    expect(rest(input({ boundary, bottom: -3, prior: made }))).toEqual({
      section: undefined,
      reason: "rough10 leaves no material for the 4 mm tool",
    });
    expect(rest(input({ boundary, prior: made })).section).toBeDefined();
  });

  it("emits no section for an empty leftover and says why", () => {
    expect(rest(input({ tool: flat(3), prior: prior(4, coarse) }))).toEqual({
      section: undefined,
      reason: "rough4 leaves no material for the 3 mm tool",
    });
  });

  it("checks the cut before it reports an empty leftover", () => {
    expect(() =>
      rest(
        input({
          tool: { ...flat(3), fluteLength: 2 },
          prior: prior(4, coarse),
        }),
      ),
    ).toThrow("a 6 mm deep cut is past the 2 mm flute length of 3 mm flat");
  });

  it("refuses a tool no smaller than the prior's", () => {
    expect(() => rest(input({ tool: flat(10) }))).toThrow(
      "a rest pass needs a tool smaller than the 10 mm tool of rough10",
    );
  });

  it("refuses a floor below the prior's floor", () => {
    expect(() => rest(input({ bottom: -8 }))).toThrow(
      "the rest floor at -8 is below the floor at -6 of rough10",
    );
  });
});

type Op = SetupOperation & { fresh: boolean };

const pocketOp = (id: string, changes: Partial<Op> = {}): Op => ({
  id,
  type: "rockett.cam.pocket",
  fresh: true,
  ...changes,
});

const status = (operations: Op[], named = "rough") =>
  restPrior({ operations }, { id: "rest", prior: named }, (op) => op.fresh);

describe("restPrior", () => {
  it("is fresh when an earlier, unsuppressed and fresh pocket is the prior", () => {
    const rough = pocketOp("rough");
    expect(status([rough, pocketOp("rest")])).toEqual({
      status: "fresh",
      prior: rough,
    });
  });

  it.each([
    ["missing", [pocketOp("rest")], "prior rough is missing"],
    [
      "later",
      [pocketOp("rest"), pocketOp("rough")],
      "prior rough is not earlier in the setup",
    ],
    [
      "not a pocket",
      [pocketOp("rough", { type: "rockett.cam.facing" }), pocketOp("rest")],
      "prior rough is not a pocket",
    ],
    [
      "suppressed",
      [pocketOp("rough", { suppressed: true }), pocketOp("rest")],
      "prior rough is suppressed",
    ],
    [
      "stale",
      [pocketOp("rough", { fresh: false }), pocketOp("rest")],
      "prior rough is stale",
    ],
  ])("makes the rest stale when the prior is %s", (_, operations, reason) => {
    expect(status(operations)).toEqual({ status: "stale", reason });
  });

  it("makes a rest naming itself stale", () => {
    expect(status([pocketOp("rest")], "rest")).toEqual({
      status: "stale",
      reason: "prior rest is not earlier in the setup",
    });
  });
});
