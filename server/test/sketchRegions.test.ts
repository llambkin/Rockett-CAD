import { beforeAll, describe, expect, it } from "vitest";
import type {
  CadDocument,
  ExtrudeFeature,
  SketchEntity,
  SketchFeature,
} from "@rockett/shared";
import {
  createEmptyDocument,
  curveHits,
  detectProfiles,
  profileIdFor,
} from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";

const S = 40;
const DEPTH = 10;
const CORNER = (S * S - (Math.PI * S * S) / 4) / 4;

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (
  id: string,
  p1: string,
  p2: string,
  construction?: boolean,
): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
  ...(construction && { construction }),
});

function inscribed(noise = 0): SketchEntity[] {
  return [
    P("a", 0, 0),
    P("b", S, 0),
    P("c", S, S),
    P("d", 0, S),
    L("l1", "a", "b"),
    L("l2", "b", "c"),
    L("l3", "c", "d"),
    L("l4", "d", "a"),
    P("o", S / 2, S / 2),
    { id: "ci", kind: "circle", center: "o", radius: S / 2 + noise },
    L("diag", "a", "c", true),
    P("mb", S / 2, 0),
    P("mt", S / 2, S),
    P("ml", 0, S / 2),
    P("mr", S, S / 2),
    L("cv", "mb", "mt", true),
    L("ch", "ml", "mr", true),
  ];
}

const areas = (entities: SketchEntity[]) =>
  detectProfiles(entities)
    .map((p) => p.area)
    .sort((x, y) => x - y);

function uniqueIds(entities: SketchEntity[]) {
  const ids = detectProfiles(entities).map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("sketch regions", () => {
  it("a circle inscribed in a square gives the disc and four corners", () => {
    for (const noise of [0, 1e-9, -1e-9]) {
      const a = areas(inscribed(noise));
      expect(a).toHaveLength(5);
      for (const corner of a.slice(0, 4))
        expect(Math.abs(corner - CORNER)).toBeLessThan(0.5);
      expect(Math.abs(a[4]! - (Math.PI * S * S) / 4)).toBeLessThan(3);
      uniqueIds(inscribed(noise));
    }
  });

  it("two overlapping circles give a lens and two crescents with distinct ids", () => {
    const entities: SketchEntity[] = [
      P("c1", 0, 0),
      P("c2", 10, 0),
      { id: "A", kind: "circle", center: "c1", radius: 10 },
      { id: "B", kind: "circle", center: "c2", radius: 10 },
    ];
    const lens = 200 * Math.acos(0.5) - 5 * Math.sqrt(300);
    const a = areas(entities);
    expect(a).toHaveLength(3);
    expect(Math.abs(a[0]! - lens)).toBeLessThan(1);
    expect(Math.abs(a[1]! - (100 * Math.PI - lens))).toBeLessThan(1);
    expect(Math.abs(a[2]! - (100 * Math.PI - lens))).toBeLessThan(1);
    uniqueIds(entities);
  });

  it("two circles touching outside stay two discs", () => {
    const entities: SketchEntity[] = [
      P("c1", 0, 0),
      P("c2", 20, 0),
      { id: "A", kind: "circle", center: "c1", radius: 10 },
      { id: "B", kind: "circle", center: "c2", radius: 10 },
    ];
    expect(areas(entities)).toHaveLength(2);
  });

  it("a line across a square splits it and a nested circle stays a hole", () => {
    const entities: SketchEntity[] = [
      ...inscribed().slice(0, 8),
      P("m1", -5, 10),
      P("m2", S + 5, 10),
      L("cut", "m1", "m2"),
      P("o", S / 2, 25),
      { id: "hole", kind: "circle", center: "o", radius: 5 },
      { id: "pin", kind: "circle", center: "o", radius: 2 },
    ];
    const profiles = detectProfiles(entities);
    expect(profiles).toHaveLength(4);
    const top = profiles.find((p) => p.holes.length === 1 && p.area > 100)!;
    expect(Math.abs(top.area - (S * 30 - 25 * Math.PI))).toBeLessThan(0.5);
    expect(
      profiles.find((p) => Math.abs(p.area - S * 10) < 1e-6),
    ).toBeDefined();
    uniqueIds(entities);
  });

  it("reports where each curve meets the others, by curve parameter", () => {
    const hits = curveHits(inscribed());
    expect(hits.get("diag")).toBeUndefined();
    const side = hits.get("l1")!;
    expect(side).toHaveLength(1);
    expect(side[0]!.t).toBeCloseTo(0.5, 9);
    const circle = hits.get("ci")!;
    expect(circle.map((h) => Math.round((h.t * 180) / Math.PI))).toEqual([
      -90, 0, 90, 180,
    ]);
    const crossing = curveHits([
      P("a", 0, 0),
      P("b", 10, 10),
      P("c", 0, 10),
      P("d", 10, 0),
      L("x", "a", "b"),
      L("y", "c", "d"),
    ]);
    expect(crossing.get("x")!.map((h) => [h.x, h.y, h.t])).toEqual([
      [5, 5, 0.5],
    ]);
  });

  it("computes 200 curves in well under 200 ms", () => {
    const entities: SketchEntity[] = [];
    for (let i = 0; i < 100; i++) {
      const x = (i % 10) * 30;
      const y = Math.floor(i / 10) * 30;
      entities.push(
        P(`o${i}`, x, y),
        { id: `c${i}`, kind: "circle", center: `o${i}`, radius: 20 },
        P(`s${i}`, x - 25, y + 5),
        P(`e${i}`, x + 25, y + 5),
        L(`l${i}`, `s${i}`, `e${i}`),
      );
    }
    detectProfiles(entities);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      detectProfiles(entities);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    console.log(`200-curve regions median ${times[2]!.toFixed(1)} ms`);
    expect(times[2]!).toBeLessThan(200);
  });
});

function docWith(entities: SketchEntity[], ids: string[]): CadDocument {
  const sketch: SketchFeature = {
    id: "sk",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities,
    constraints: [],
  };
  const extrude: ExtrudeFeature = {
    id: "ex",
    type: "extrude",
    name: "Extrude",
    suppressed: false,
    profiles: ids.map((profileId) => ({ sketchId: "sk", profileId })),
    distance: DEPTH,
    direction: "normal",
    operation: "join",
  };
  const doc = createEmptyDocument("regions", "Regions");
  doc.features = [sketch, extrude];
  doc.timelinePosition = 2;
  return doc;
}

describe("extruding sketch regions", () => {
  beforeAll(async () => {
    await initKernel();
  }, 120_000);

  function extrude(entities: SketchEntity[], ids: string[]) {
    dropEngine("regions");
    const engine = engineFor("regions");
    const doc = docWith(entities, ids);
    const result = engine.evaluate(doc);
    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    const volumes = [...engine.stateAt(doc).bodies.values()].map((b) =>
      volumeOf(b.shape),
    );
    dropEngine("regions");
    return volumes;
  }

  it("extrudes one corner of the inscribed circle on its own", () => {
    const corner = detectProfiles(inscribed()).find(
      (p) => Math.abs(p.area - CORNER) < 0.5,
    )!;
    const volumes = extrude(inscribed(), [corner.id]);
    expect(volumes).toHaveLength(1);
    expect(volumes[0]!).toBeCloseTo(CORNER * DEPTH, 3);
  });

  it("extrudes all five regions to the full square", () => {
    const ids = detectProfiles(inscribed()).map((p) => p.id);
    const volumes = extrude(inscribed(), ids);
    expect(volumes).toHaveLength(1);
    expect(volumes[0]!).toBeCloseTo(S * S * DEPTH, 3);
  });

  it("keeps a saved whole-square region from before the split", () => {
    const legacy = profileIdFor(["l1", "l2", "l3", "l4"], []);
    const volumes = extrude(inscribed(), [legacy]);
    expect(volumes).toHaveLength(1);
    expect(volumes[0]!).toBeCloseTo(S * S * DEPTH, 3);
  });
});
