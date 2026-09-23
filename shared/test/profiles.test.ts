import { describe, expect, it } from "vitest";
import { detectProfiles } from "../src/profiles.js";
import type { SketchEntity } from "../src/model.js";

function rect(
  idPrefix: string,
  x: number,
  y: number,
  w: number,
  h: number,
): SketchEntity[] {
  return [
    { id: `${idPrefix}pa`, kind: "point", x, y },
    { id: `${idPrefix}pb`, kind: "point", x: x + w, y },
    { id: `${idPrefix}pc`, kind: "point", x: x + w, y: y + h },
    { id: `${idPrefix}pd`, kind: "point", x, y: y + h },
    {
      id: `${idPrefix}l1`,
      kind: "line",
      p1: `${idPrefix}pa`,
      p2: `${idPrefix}pb`,
    },
    {
      id: `${idPrefix}l2`,
      kind: "line",
      p1: `${idPrefix}pb`,
      p2: `${idPrefix}pc`,
    },
    {
      id: `${idPrefix}l3`,
      kind: "line",
      p1: `${idPrefix}pc`,
      p2: `${idPrefix}pd`,
    },
    {
      id: `${idPrefix}l4`,
      kind: "line",
      p1: `${idPrefix}pd`,
      p2: `${idPrefix}pa`,
    },
  ];
}

describe("profile detection", () => {
  it("finds a rectangle region", () => {
    const profiles = detectProfiles(rect("r", 0, 0, 100, 50));
    expect(profiles).toHaveLength(1);
    expect(profiles[0].outer).toHaveLength(4);
    expect(profiles[0].area).toBeCloseTo(5000, 3);
  });

  it("finds circle region and treats inner circle as hole", () => {
    const entities: SketchEntity[] = [
      { id: "c1", kind: "point", x: 0, y: 0 },
      { id: "circ1", kind: "circle", center: "c1", radius: 20 },
      { id: "circ2", kind: "circle", center: "c1", radius: 8 },
    ];
    const profiles = detectProfiles(entities);
    // outer annulus (with hole) + inner disc
    expect(profiles.length).toBe(2);
    const annulus = profiles.find((p) => p.holes.length === 1)!;
    expect(annulus).toBeTruthy();
    // areas are computed from sampled polygons — allow ~0.3% tolerance
    expect(Math.abs(annulus.area - Math.PI * (400 - 64))).toBeLessThan(4);
    const disc = profiles.find((p) => p.holes.length === 0)!;
    expect(Math.abs(disc.area - Math.PI * 64)).toBeLessThan(1);
  });

  it("circle inside rectangle becomes a hole", () => {
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, 100, 50),
      { id: "cc", kind: "point", x: 50, y: 25 },
      { id: "circ", kind: "circle", center: "cc", radius: 10 },
    ];
    const profiles = detectProfiles(entities);
    const rectProfile = profiles.find((p) => p.outer.length === 4)!;
    expect(rectProfile.holes).toHaveLength(1);
    expect(Math.abs(rectProfile.area - (5000 - Math.PI * 100))).toBeLessThan(2);
    // the circle disc itself is also selectable
    const disc = profiles.find((p) => p.outer.length === 1);
    expect(disc).toBeTruthy();
  });

  it("splits two adjacent rectangles sharing an edge into two regions", () => {
    // Two rectangles side by side sharing vertical edge at x=50
    const entities: SketchEntity[] = [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 50, y: 0 },
      { id: "c", kind: "point", x: 100, y: 0 },
      { id: "d", kind: "point", x: 100, y: 40 },
      { id: "e", kind: "point", x: 50, y: 40 },
      { id: "f", kind: "point", x: 0, y: 40 },
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "l2", kind: "line", p1: "b", p2: "c" },
      { id: "l3", kind: "line", p1: "c", p2: "d" },
      { id: "l4", kind: "line", p1: "d", p2: "e" },
      { id: "l5", kind: "line", p1: "e", p2: "f" },
      { id: "l6", kind: "line", p1: "f", p2: "a" },
      { id: "mid", kind: "line", p1: "b", p2: "e" },
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(2);
    expect(profiles[0].area + profiles[1].area).toBeCloseTo(4000, 3);
  });

  it("ignores construction geometry", () => {
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, 10, 10),
      { id: "cp1", kind: "point", x: 0, y: 0 },
      { id: "cp2", kind: "point", x: 10, y: 10 },
      { id: "diag", kind: "line", p1: "cp1", p2: "cp2", construction: true },
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
  });

  it("profile ids are stable across re-detection", () => {
    const e1 = rect("r", 0, 0, 100, 50);
    const p1 = detectProfiles(e1);
    const e2 = rect("r", 0, 0, 120, 50); // same entities, different size
    const p2 = detectProfiles(e2);
    expect(p1[0].id).toBe(p2[0].id);
  });
});

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

/** Four-point star: square ±25 with radial guide lines from the centre to the
 * tips at ±75 and the outline joining corners to tips. The radials cross the
 * square's edges at their interiors with no sketch point there. */
function ninjaStar(): SketchEntity[] {
  return [
    P("A", -25, -25),
    P("B", 25, -25),
    P("C", 25, 25),
    P("D", -25, 25),
    L("sq1", "A", "B"),
    L("sq2", "B", "C"),
    L("sq3", "C", "D"),
    L("sq4", "D", "A"),
    P("O", 0, 0),
    P("Dn", 0, -75),
    P("Rt", 75, 0),
    P("Up", 0, 75),
    P("Lf", -75, 0),
    L("rad1", "O", "Dn"),
    L("rad2", "O", "Rt"),
    L("rad3", "O", "Up"),
    L("rad4", "O", "Lf"),
    L("o1", "A", "Lf"),
    L("o2", "Lf", "D"),
    L("o3", "D", "Up"),
    L("o4", "Up", "C"),
    L("o5", "C", "Rt"),
    L("o6", "Rt", "B"),
    L("o7", "B", "Dn"),
    L("o8", "Dn", "A"),
  ];
}

describe("crossing curves (X-junctions)", () => {
  it("two diagonals crossing inside a square make four triangles", () => {
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, 10, 10),
      L("d1", "rpa", "rpc"),
      L("d2", "rpb", "rpd"),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(4);
    for (const p of profiles) expect(p.area).toBeCloseTo(25, 6);
  });

  it("a line crossing right through a square splits it in two; the overhanging stubs form nothing", () => {
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, 10, 10),
      P("m1", -5, 5),
      P("m2", 15, 5),
      L("cut", "m1", "m2"),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(2);
    for (const p of profiles) expect(p.area).toBeCloseTo(50, 6);
    // the split pieces of the cutting line carry trim so the server can
    // build the wire from the inside portion only
    const cutPieces = profiles.flatMap((p) =>
      p.outer.filter((c) => c.entityId === "cut"),
    );
    expect(cutPieces.length).toBeGreaterThan(0);
    for (const c of cutPieces) {
      expect(c.trim).toBeDefined();
      const [sx, , ex] = c.trim!;
      expect(Math.min(sx, ex)).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(sx, ex)).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it("many curves through one point register a single crossing node", () => {
    // both diagonals plus both midlines all meet at (5,5): six pairs, one node
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, 10, 10),
      L("d1", "rpa", "rpc"),
      L("d2", "rpb", "rpd"),
      P("mb", 5, 0),
      P("mt", 5, 10),
      P("ml", 0, 5),
      P("mr", 10, 5),
      L("v", "mb", "mt"),
      L("h", "ml", "mr"),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(8);
    for (const p of profiles) expect(p.area).toBeCloseTo(12.5, 6);
  });

  it("a line crossing an arc splits a D-shape in half", () => {
    const entities: SketchEntity[] = [
      P("c", 0, 0),
      P("s", 10, 0),
      P("e", -10, 0),
      { id: "arc", kind: "arc", center: "c", start: "s", end: "e" },
      L("base", "e", "s"),
      P("v1", 0, -2),
      P("v2", 0, 12),
      L("v", "v1", "v2"),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(2);
    for (const p of profiles)
      expect(Math.abs(p.area - 25 * Math.PI)).toBeLessThan(0.5);
  });

  it("two arcs crossing each other enclose a lens", () => {
    // upper half of a circle at the origin and lower half of a circle 10 above:
    // they cross at (±√75, 5) and enclose a lens; the arc tails dangle.
    const entities: SketchEntity[] = [
      P("c1", 0, 0),
      P("s1", 10, 0),
      P("e1", -10, 0),
      { id: "a1", kind: "arc", center: "c1", start: "s1", end: "e1" },
      P("c2", 0, 10),
      P("s2", -10, 10),
      P("e2", 10, 10),
      { id: "a2", kind: "arc", center: "c2", start: "s2", end: "e2" },
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
    const lens = 200 * Math.acos(0.5) - 5 * Math.sqrt(300);
    expect(Math.abs(profiles[0].area - lens)).toBeLessThan(1);
  });

  it("ninja star: radial guide lines carve the square into quadrants and each point in half", () => {
    const profiles = detectProfiles(ninjaStar());
    expect(profiles).toHaveLength(12);
    for (const p of profiles) expect(p.area).toBeCloseTo(625, 6);
    const total = profiles.reduce((s, p) => s + p.area, 0);
    expect(total).toBeCloseTo(7500, 6);
  });

  it("a line across a circle inside a rectangle splits both (no overlapping regions)", () => {
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, 40, 20),
      P("cc", 20, 10),
      { id: "ci", kind: "circle", center: "cc", radius: 5 },
      P("m1", 0, 10),
      P("m2", 40, 10),
      L("cut", "m1", "m2"),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(4);
    const areas = profiles.map((p) => p.area).sort((a, b) => a - b);
    const half = (Math.PI * 25) / 2;
    expect(Math.abs(areas[0] - half)).toBeLessThan(0.3);
    expect(Math.abs(areas[1] - half)).toBeLessThan(0.3);
    expect(Math.abs(areas[2] - (400 - half))).toBeLessThan(0.3);
    expect(Math.abs(areas[3] - (400 - half))).toBeLessThan(0.3);
    // the circle pieces carry trim so the server can build them as arcs
    const arcs = profiles.flatMap((p) =>
      p.outer.filter((c) => c.entityId === "ci"),
    );
    expect(arcs.length).toBeGreaterThan(0);
    for (const a of arcs) expect(a.trim).toBeDefined();
  });

  it("a curve merely ending on a circle leaves the disc whole", () => {
    const entities: SketchEntity[] = [
      P("cc", 0, 0),
      { id: "ci", kind: "circle", center: "cc", radius: 5 },
      P("t1", 5, 0),
      P("t2", 15, 0),
      L("tail", "t1", "t2"),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(1);
    expect(Math.abs(profiles[0].area - Math.PI * 25)).toBeLessThan(0.3);
  });

  it("ninja star with a centre circle: four quarter discs and four notched quadrants", () => {
    const entities: SketchEntity[] = [
      ...ninjaStar(),
      P("cc", 0, 0),
      { id: "ci", kind: "circle", center: "cc", radius: 12.5 },
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(16);
    expect(
      Math.abs(profiles.reduce((s, p) => s + p.area, 0) - 7500),
    ).toBeLessThan(1);
    const quarter = (Math.PI * 12.5 * 12.5) / 4;
    expect(
      profiles.filter((p) => Math.abs(p.area - quarter) < 0.5),
    ).toHaveLength(4);
    expect(
      profiles.filter((p) => Math.abs(p.area - (625 - quarter)) < 0.5),
    ).toHaveLength(4);
  });

  it("ninja star without the radials is a square plus four triangles", () => {
    const entities = ninjaStar().filter((e) => !e.id.startsWith("rad"));
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(5);
    const areas = profiles.map((p) => Math.round(p.area)).sort((a, b) => a - b);
    expect(areas).toEqual([1250, 1250, 1250, 1250, 2500]);
  });
});
