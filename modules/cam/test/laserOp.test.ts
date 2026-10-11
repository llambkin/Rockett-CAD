import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { GenerateInput } from "../src/kernel/input.js";
import type { RegionLoop } from "../src/kernel/regions.js";
import { checkProgram } from "../src/post/check.js";
import { formatProgram } from "../src/post/format.js";
import { normalise } from "../src/post/normalise.js";
import type { Move, Program, Section, Xy } from "../src/shared/ir.js";
import { newMachine, type MachineProfile } from "../src/shared/machine.js";
import type { Setup } from "../src/shared/setup.js";
import type { Preset } from "../src/shared/tools.js";
import { laser, type LaserInput } from "../src/toolpath/laser.js";
import { loadPost } from "./goldens.js";
import {
  box,
  brep,
  cut,
  cylinder,
  moduleJob,
  oc,
  scoped,
  startKernel,
} from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;
const CENTRE: Xy = [20, 20];

const beam = {
  id: "t1",
  number: 1,
  name: "Laser 0.2 mm beam",
  kind: "flat",
  diameter: 0.2,
  fluteLength: 2,
  overallLength: 10,
  shankDiameter: 0.2,
  flutes: 1,
  centreCutting: true,
} as const;

const preset: Preset = {
  id: "p1",
  name: "3 mm ply",
  rpm: 1,
  cutFeed: 1000,
  plungeFeed: 600,
  rampFeed: 600,
  stepdown: 1,
  stepoverFraction: 0.5,
  coolant: "off",
};

const setup: Setup = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: {
    kind: "boxAround",
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
  },
  wcs: {
    origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
    axes: { x: "+x", z: "+z" },
    offsetIndex: 1,
    machine: { kind: "unknown" },
  },
  safeHeight: 15,
  clearance: 3,
  tolerance: 0.01,
  fixtures: [],
};

const stock = { min: [0, 0, -3], max: [40, 40, 0] } as LaserInput["stock"];

let body: GenerateInput["bodies"][number];
let face: { kind: "face"; bodyId: string; faceName: string; sig: object };

function topFace(text: string) {
  return scoped((own) => {
    const shape = own(new oc.TopoDS_Shape());
    const file = `/rockett-cam-laser-${crypto.randomUUID()}.brep`;
    oc.FS.writeFile(file, text);
    oc.BRepTools.Read_2(
      shape,
      file,
      own(new oc.BRep_Builder()),
      own(new oc.Message_ProgressRange_1()),
    );
    oc.FS.unlink(file);
    const found = own(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    const centres: number[][] = [];
    for (; found.More(); found.Next()) {
      const props = own(new oc.GProp_GProps_1());
      oc.BRepGProp.SurfaceProperties_1(
        own(oc.TopoDS.Face_1(own(found.Current()))),
        props,
        false,
        false,
      );
      const c = own(props.CentreOfMass());
      centres.push([c.X(), c.Y(), c.Z()]);
    }
    const index = centres.findIndex(([, , z]) => Math.abs(z! - 3) < 1e-9);
    return { index, point: centres[index]!, count: centres.length };
  });
}

beforeAll(async () => {
  await startKernel();
  const text = brep((own) =>
    cut(
      own,
      box(own, [0, 0, 0], [40, 40, 3]),
      cylinder(own, [20, 20, -1], [0, 0, 1], 5),
    ),
  );
  const top = topFace(text);
  face = {
    kind: "face",
    bodyId: "b1",
    faceName: `f:plate:${top.index}`,
    sig: { type: "plane", point: top.point, direction: [0, 0, 1] },
  };
  body = {
    id: "b1",
    brep: text,
    faceNames: Array.from({ length: top.count }, (_, i) => `f:plate:${i}`),
    bbox: { min: [0, 0, 0], max: [40, 40, 3] },
  };
}, 120_000);

const params = (changes: Record<string, unknown> = {}) => ({
  face,
  side: "outside",
  power: 80,
  feed: 1500,
  passes: 2,
  zStep: 0.5,
  ...changes,
});

const generate = (
  changes: Record<string, unknown> = {},
  tool: GenerateInput["tool"] = beam,
) =>
  moduleJob(ENTRY, "rockett.cam.generate", {
    setup,
    operation: {
      id: "laser-1",
      type: "rockett.cam.laser",
      params: params(changes),
    },
    tool,
    preset,
    bodies: [body],
  } satisfies GenerateInput) as Promise<Program>;

type Run = { z: number; points: Xy[]; arcs: Move[] };

function runs(section: Section): Run[] {
  const out: Run[] = [];
  let open = false;
  for (const move of section.moves) {
    const cutting =
      (move.kind === "feed" || move.kind === "arc") && move.role === "cut";
    if (!cutting) {
      open = false;
      continue;
    }
    if (!open) out.push({ z: move.to[2], points: [], arcs: [] });
    open = true;
    out.at(-1)!.points.push([move.to[0], move.to[1]]);
    if (move.kind === "arc") out.at(-1)!.arcs.push(move);
  }
  return out;
}

const fromCentre = ([x, y]: Xy) => Math.hypot(x - CENTRE[0], y - CENTRE[1]);

function outsideSquare([x, y]: Xy, lo: number, hi: number) {
  const dx = Math.max(lo - x, 0, x - hi);
  const dy = Math.max(lo - y, 0, y - hi);
  return Math.hypot(dx, dy);
}

function insideSquare([x, y]: Xy, lo: number, hi: number) {
  return Math.min(x - lo, hi - x, y - lo, hi - y);
}

const spread = (values: number[]) => [Math.min(...values), Math.max(...values)];

const powered = (words: string[]) =>
  words.filter((word) => word.startsWith("S") && word !== "S0");

const snapped = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_, item: unknown) =>
      typeof item === "number" ? Math.round(item * 1e9) / 1e9 || 0 : item,
    ),
  );

const square = (lo: number, hi: number): RegionLoop => ({
  start: [lo, lo],
  segments: [
    { kind: "line", to: [hi, lo] },
    { kind: "line", to: [hi, hi] },
    { kind: "line", to: [lo, hi] },
    { kind: "line", to: [lo, lo] },
  ],
});

const circle = (radius: number): RegionLoop => ({
  start: [CENTRE[0] + radius, CENTRE[1]],
  segments: [
    {
      kind: "arc",
      to: [CENTRE[0] + radius, CENTRE[1]],
      centre: CENTRE,
      dir: "ccw",
    },
  ],
});

const path = (changes: Partial<LaserInput> = {}) =>
  laser({
    operationId: "laser-1",
    setup,
    stock,
    tool: beam,
    preset,
    profiles: [square(0, 40), circle(5)],
    side: "outside",
    power: 80,
    feed: 1500,
    passes: 1,
    ...changes,
  });

describe("rockett.cam.laser through generate", () => {
  it("cuts the 10 mm hole first at radius 4.9 mm, then the 40 mm square 0.1 mm outward", async () => {
    const { sections } = await generate();
    const [section] = sections;
    expect(sections).toHaveLength(1);
    expect(section!.spindle).toBeUndefined();
    const [hole1, hole2, outer1, outer2, ...rest] = runs(section!);
    expect(rest).toEqual([]);
    expect([hole1!.z, hole2!.z, outer1!.z, outer2!.z]).toEqual([
      0, -0.5, 0, -0.5,
    ]);
    for (const run of [hole1!, hole2!]) {
      const [lo, hi] = spread(run.points.map(fromCentre));
      expect(lo).toBeGreaterThan(4.9 - 1e-3);
      expect(hi).toBeLessThan(4.9 + 1e-3);
    }
    for (const run of [outer1!, outer2!]) {
      const [lo, hi] = spread(run.points.map((p) => outsideSquare(p, 0, 40)));
      expect(lo).toBeGreaterThan(0.1 - 1e-3);
      expect(hi).toBeLessThan(0.1 + 1e-3);
    }
    const roles = section!.moves.flatMap((move) =>
      move.kind === "feed" || move.kind === "arc"
        ? [`${move.role} ${move.power}`]
        : [],
    );
    expect(new Set(roles)).toEqual(new Set(["plunge undefined", "cut 80"]));
  });

  it("matches the golden IR", async () => {
    const { sections } = await generate();
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/laser.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(snapped(sections[0])).toEqual(golden);
  });

  it("passes the program check on a laser and fails it on a mill", async () => {
    const program = await generate();
    const problems = (machine: MachineProfile) =>
      checkProgram({
        program,
        setup,
        stock,
        operations: [{ id: "laser-1", type: "rockett.cam.laser" }],
        machine,
        post: loadPost("grbl"),
        units: "mm",
      }).problems.filter(({ rule }) => rule === "laser" || rule === "tool");
    const head: MachineProfile = {
      ...newMachine(0),
      kind: "laser",
      laserPowerMax: 1000,
      focusZ: 0,
      laserMode: true,
    };
    expect(problems(head)).toEqual([]);
    expect(problems(newMachine(0))).toContainEqual(
      expect.objectContaining({
        reason: "a mill cannot run a laser operation",
      }),
    );
  });

  it("never powers the beam on a rapid or a plunge in GRBL output", async () => {
    const grbl = loadPost("grbl");
    const program = await generate();
    const files = formatProgram(
      normalise(program, grbl, { units: "mm" }),
      grbl,
      { laserPowerMax: 1000 },
    );
    expect(files).toHaveLength(1);
    let mode = "";
    const rapids: string[][] = [];
    const plunges: string[][] = [];
    for (const line of files[0]!.split("\n")) {
      const words = line.replace(/\(.*\)/, "").match(/[A-Z]-?[\d.]+/g) ?? [];
      for (const word of words) if (/^G[0-3]$/.test(word)) mode = word;
      const axes = words.filter((word) => /^[XYZ]/.test(word));
      if (!axes.length) continue;
      if (mode === "G0") rapids.push(words);
      if (mode === "G1" && axes.every((word) => word.startsWith("Z")))
        plunges.push(words);
    }
    expect(rapids.length).toBeGreaterThan(0);
    expect(rapids.flatMap(powered)).toEqual([]);
    const irPlunges = program.sections[0]!.moves.filter(
      (move) => move.kind === "feed" && move.role === "plunge",
    );
    expect(plunges).toHaveLength(irPlunges.length);
    for (const words of plunges) expect(words).toContain("S0");
  });

  it("refuses at generate a power outside 0 to 100, no passes, and a mill tool", async () => {
    await expect(generate({ power: 101 })).rejects.toThrow(
      "laser power 101% is outside 0 to 100",
    );
    await expect(generate({ passes: 0 })).rejects.toThrow(
      /^rockett\.cam\.laser params: passes /,
    );
    await expect(
      generate({ zStep: undefined, passes: 1 }),
    ).resolves.toMatchObject({
      tools: [beam],
    });
    await expect(generate({}, { ...beam, kind: "ball" })).rejects.toThrow(
      "laser needs a flat end mill, not a ball",
    );
  });
});

describe("laser toolpath", () => {
  it("cuts inside: the hole 0.1 mm outward and the square 0.1 mm inward", () => {
    const [hole, outer] = runs(path({ side: "inside" }));
    const [hlo, hhi] = spread(hole!.points.map(fromCentre));
    expect(hlo).toBeGreaterThan(5.1 - 1e-3);
    expect(hhi).toBeLessThan(5.1 + 1e-3);
    const [slo, shi] = spread(outer!.points.map((p) => insideSquare(p, 0, 40)));
    expect(slo).toBeGreaterThan(0.1 - 1e-3);
    expect(shi).toBeLessThan(0.1 + 1e-3);
  });

  it("cuts on the line with the profile's own arcs, and open curves first", () => {
    const curve: RegionLoop = {
      start: [2, 2],
      segments: [
        { kind: "line", to: [8, 2] },
        { kind: "line", to: [8, 8] },
      ],
    };
    const section = path({
      side: "on",
      profiles: [square(0, 40), circle(5), curve],
      passes: 2,
      zStep: 1,
    });
    const [open1, open2, hole1, hole2, outer1, outer2] = runs(section);
    expect(open1!.points).toEqual([
      [8, 2],
      [8, 8],
    ]);
    expect(open2).toMatchObject({ z: -1, points: open1!.points });
    expect(hole1!.arcs).toEqual([
      expect.objectContaining({
        centre: [20, 20, 0],
        to: [25, 20, 0],
        power: 80,
      }),
    ]);
    expect(hole2!.z).toBe(-1);
    expect(outer1!.points).toEqual(square(0, 40).segments.map(({ to }) => to));
    expect(outer2!.z).toBe(-1);
    const rapids = section.moves.filter((move) => move.kind === "rapid");
    expect(rapids.slice(0, 4).map((move) => move.to)).toEqual([
      [2, 2, 15],
      [2, 2, 3],
      [8, 8, 3],
      [2, 2, 3],
    ]);
  });

  it("runs each profile before the profile that contains it, offsetting by nesting depth", () => {
    const [island, hole, outer] = runs(
      path({ profiles: [square(0, 40), square(5, 35), square(10, 30)] }),
    );
    expect(
      spread(island!.points.map((p) => outsideSquare(p, 10, 30)))[0],
    ).toBeCloseTo(0.1, 3);
    expect(
      spread(hole!.points.map((p) => insideSquare(p, 5, 35)))[0],
    ).toBeCloseTo(0.1, 3);
    expect(
      spread(outer!.points.map((p) => outsideSquare(p, 0, 40)))[0],
    ).toBeCloseTo(0.1, 3);
  });

  it("refuses a hole the kerf closes and passes below the stock bottom", () => {
    expect(() => path({ profiles: [square(0, 40), circle(0.05)] })).toThrow(
      "outside offset by half the 0.2 mm kerf leaves no path: a profile is narrower than the kerf",
    );
    expect(() => path({ passes: 8, zStep: 0.5 })).toThrow(
      "pass 8 of 8 at Z -3.5 is below the stock bottom at -3",
    );
  });

  it("cuts a last pass at the stock bottom despite rounding, and refuses one step past it", () => {
    const sheet = {
      min: [0, 0, -0.3],
      max: [40, 40, 0],
    } as LaserInput["stock"];
    expect(3 * 0.1).toBeGreaterThan(0.3);
    const last = runs(path({ stock: sheet, passes: 4, zStep: 0.1 })).at(-1)!;
    expect(last.z).toBeCloseTo(-0.3, 12);
    expect(() => path({ stock: sheet, passes: 5, zStep: 0.1 })).toThrow(
      /^pass 5 of 5 at Z -0\.4\d* is below the stock bottom at -0\.3$/,
    );
  });
});
