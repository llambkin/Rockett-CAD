import { serverRegister } from "./helpers/serverRegister.js";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CadDocument, ServerBody, User } from "@rockett/plugin-api";
import cam from "../server.js";
import type { FeaturesInput } from "../src/kernel/features.js";
import type { PlanFeatures, ProfileFeature } from "../src/plan/plan.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  generateRoute,
  type CamData,
} from "../src/shared/document.js";
import { formatProgram } from "../src/post/format.js";
import { normalise } from "../src/post/normalise.js";
import { validateProgram, type Program } from "../src/shared/ir.js";
import type { Box, Fixture } from "../src/shared/setup.js";
import type { Preset } from "../src/shared/tools.js";
import { contour } from "../src/toolpath/contour.js";
import { facing } from "../src/toolpath/facing.js";
import { chorded } from "../src/toolpath/geometry.js";
import { pocket } from "../src/toolpath/pocket.js";
import { lines, loadPost } from "./goldens.js";
import { blockSetup, featureBlock, openedBlock } from "./helpers/blocks.js";
import { box, brep, cut, oc, scoped, startKernel } from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;

const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

type Ref = {
  kind: "face";
  bodyId: string;
  faceName: string;
  sig: { type: "plane"; point: number[]; direction: number[] };
};

let body: ServerBody;
let top: Ref;
let floor: Ref;
let kernel: {
  moduleJob(
    entry: string,
    id: string,
    input: unknown,
    hooks: object,
  ): Promise<unknown>;
};
let files: Awaited<ReturnType<typeof storage>>;
const dirs: string[] = [];

async function storage() {
  const [{ moduleFiles }, { LocalStorage }] = await Promise.all([
    core("modules/files.ts"),
    core("store/storage.ts"),
  ]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-ops-"));
  dirs.push(dir);
  return moduleFiles(new LocalStorage(dir, fs), "rockett.cam");
}

function planarFaces(text: string) {
  return scoped((own) => {
    const shape = own(new oc.TopoDS_Shape());
    const file = `/rockett-cam-ops-${crypto.randomUUID()}.brep`;
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
    const out: { point: number[]; up: number; area: number }[] = [];
    for (; found.More(); found.Next()) {
      const face = own(oc.TopoDS.Face_1(own(found.Current())));
      const props = own(new oc.GProp_GProps_1());
      oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
      const c = own(props.CentreOfMass());
      const surface = own(new oc.BRepAdaptor_Surface_2(face, true));
      const z = own(own(own(surface.Plane()).Axis()).Direction()).Z();
      const flip =
        face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
      out.push({
        point: [c.X(), c.Y(), c.Z()],
        up: z * flip,
        area: props.Mass(),
      });
    }
    return out;
  });
}

const named = (index: number, point: number[]): Ref => ({
  kind: "face",
  bodyId: "b1",
  faceName: `f:plate:${index}`,
  sig: { type: "plane", point, direction: [0, 0, 1] },
});

beforeAll(async () => {
  await startKernel();
  const { InProcessKernel } = await core("kernel/client.ts");
  kernel = new InProcessKernel({ sources: async () => new Map() });
  files = await storage();
  const text = brep((own) =>
    cut(
      own,
      box(own, [0, 0, 0], [40, 30, 10]),
      box(own, [10, 10, 6], [20, 10, 5]),
    ),
  );
  const faces = planarFaces(text);
  const upAt = (z: number) =>
    faces.findIndex(
      ({ up, point }) => up > 0.5 && Math.abs(point[2]! - z) < 1e-9,
    );
  top = named(upAt(10), faces[upAt(10)]!.point);
  floor = named(upAt(6), faces[upAt(6)]!.point);
  body = {
    id: "b1",
    name: "Plate",
    bbox: { min: [0, 0, 0], max: [40, 30, 10] } as ServerBody["bbox"],
    brep: text,
    faceNames: faces.map((_, i) => `f:plate:${i}`),
    fingerprint: "e".repeat(64),
  };
}, 120_000);

afterAll(() =>
  Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))),
);

const tool = {
  id: "t1",
  name: "4 mm flat",
  kind: "flat" as const,
  diameter: 4,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 4,
  flutes: 2,
  centreCutting: true,
  number: 1,
};

const preset = {
  id: "p1",
  name: "MDF",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 2,
  stepoverFraction: 0.4,
  coolant: "off" as const,
};

type Change = { preset?: Partial<Preset>; pocket?: object };

function data({ preset: change, pocket: pocketChange }: Change = {}): CamData {
  return {
    setups: [
      {
        id: "s1",
        name: "Setup 1",
        bodies: ["b1"],
        stock: {
          kind: "boxAround",
          margins: { xMin: 5, xMax: 5, yMin: 5, yMax: 5, zMin: 0, zMax: 0 },
        },
        wcs: {
          origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
          axes: { x: "+x", z: "+z" },
          offsetIndex: 1,
          machine: { kind: "unknown" },
        },
        safeHeight: 15,
        clearance: 3,
        operations: [
          {
            id: "contour",
            type: "rockett.cam.contour",
            name: "Profile",
            toolId: "t1",
            presetId: "p1",
            params: { face: top, side: "outside", bottomOffset: 0.5 },
          },
          {
            id: "pocket",
            type: "rockett.cam.pocket",
            name: "Pocket",
            toolId: "t1",
            presetId: "p1",
            params: { floor, rampAngle: 3, ...pocketChange },
          },
        ],
      },
    ],
    tools: [{ ...tool, presets: [{ ...preset, ...change }] }],
  };
}

type Edit = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

async function route(of = () => body) {
  const edits = new Map<string, Edit>();
  const startKernelJob = (id: string, input: unknown) =>
    kernel.moduleJob(ENTRY, id, input, { shouldStop: () => false });
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount({
        projectRoute: () => {},
        userRoute: () => {},
        projectMutation: (r, edit) => edits.set(r.path, edit as Edit),
      });
      return () => {};
    }),
    startKernelJob,
    userData: () => ({ read: async () => null, write: async () => null! }),
    files,
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => [of()],
  });
  return (camData: CamData, operationId: string) =>
    edits.get(generateRoute.path)!(
      {
        extensions: {
          [CAM_EXTENSION]: { version: CAM_VERSION, data: camData },
        },
      } as unknown as CadDocument,
      { params: { id: "p1" }, body: { setupId: "s1", operationId } },
      { user: mark },
    ) as Promise<{ program: Program }>;
}

const centre = (y: number) => (y > -1 ? 0 : -2);

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("contour and pocket through rockett.cam.generate", () => {
  it("returns a contour and a pocket program that pass validateProgram", async () => {
    const generate = await route();
    for (const id of ["contour", "pocket"]) {
      const { program } = await generate(data(), id);
      expect(validateProgram(program)).toEqual([]);
      expect(program.sections.map((s) => s.operationId)).toEqual([id]);
      expect(program.sections[0]!.moves.length).toBeGreaterThan(10);
    }
  }, 120_000);

  it("keeps an upward face's contour program byte for byte", async () => {
    const generate = await route();
    const golden = readFileSync(
      new URL("golden/ir/contourFace.json", import.meta.url),
      "utf8",
    );
    expect(JSON.stringify((await generate(data(), "contour")).program)).toBe(
      JSON.stringify(JSON.parse(golden)),
    );
  }, 120_000);

  it("emits G187 P4 before the finish pass of a preset with profile 4", async () => {
    const generate = await route();
    const post = loadPost("grblhal");
    const nc = (program: Program) =>
      lines(
        formatProgram(normalise(program, post, { units: "mm" }), post, {
          accelerationProfiles: true,
        }),
      );
    const run = async (id: string, profile?: number) =>
      (
        await generate(
          data(profile === undefined ? {} : { preset: { profile } }),
          id,
        )
      ).program;
    const plain = await run("contour");
    const four = await run("contour", 4);
    expect(JSON.stringify(await run("contour", 3))).toBe(JSON.stringify(plain));
    expect(Object.hasOwn(plain.sections[0]!, "profile")).toBe(false);
    expect(
      Object.hasOwn((await run("pocket", 4)).sections[0]!, "profile"),
    ).toBe(false);
    expect(four.sections[0]!.profile).toBe(4);
    const out = nc(four);
    const at = out.indexOf("G187 P4");
    expect(out[at - 1]).toMatch(/^(G0 )?Z/);
    expect(out[at + 1]).toMatch(/^G1 Z-/);
    expect(out).not.toContain("G187 P3");
    expect(out.map((line) => line.replace("G187 P4", "G187 P3"))).toEqual(
      nc(plain),
    );
  }, 120_000);

  it("refuses a stepover fraction of 0.01, naming its limit", async () => {
    const generate = await route();
    await expect(
      generate(data({ preset: { stepoverFraction: 0.01 } }), "pocket"),
    ).rejects.toThrow(/stepover fraction.*0\.05/);
  }, 120_000);

  it("refuses a moved or unstable face and work past its limits", async () => {
    const generate = await route();
    const moved = { ...floor, sig: { ...floor.sig, point: [25, 20, 7] } };
    for (const [change, reason] of [
      [{ pocket: { floor: moved } }, /no longer matches the face/],
      [
        { pocket: { floor: { ...floor, faceName: `${floor.faceName}~?1` } } },
        /not a stable name/,
      ],
      [{ pocket: { floor: { ...floor, faceName: "" } } }, /not a stable name/],
      [
        { pocket: { rampAngle: 0.3 } },
        /ramp angle must be at least 0\.5 and below 90 degrees/,
      ],
      [{ preset: { stepdown: 0.005 } }, /stepdown must be at least 0\.01 mm/],
      [{ pocket: { rampAngle: "3" } }, /params: rampAngle/],
    ] as const)
      await expect(generate(data(change), "pocket")).rejects.toThrow(reason);
  }, 120_000);

  it("chords a pocket wire's arcs within 0.0005 mm", () => {
    const points = chorded({
      start: [5, 0],
      segments: [
        { kind: "arc", to: [-5, 0], centre: [0, 0], dir: "ccw" },
        { kind: "line", to: [-5, -2] },
        { kind: "arc", to: [5, -2], centre: [0, -2], dir: "ccw" },
        { kind: "line", to: [5, 0] },
      ],
    });
    for (const [i, a] of points.entries()) {
      const b = points[(i + 1) % points.length]!;
      if (a.x === b.x) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = Math.hypot(mid.x, mid.y - centre(a.y));
      expect(Math.hypot(a.x, a.y - centre(a.y))).toBeCloseTo(5, 9);
      expect(5 - r).toBeLessThanOrEqual(0.0005);
      expect(5 - r).toBeGreaterThan(0.0001);
    }
  });

  it("stops at the move limit while emitting, before the last depth level", () => {
    const deep = {
      operationId: "deep",
      setup: { safeHeight: 15, clearance: 3, fixtures: [] },
      stock: { min: [-10, -10, -30], max: [110, 110, 0] } as Box,
      tool,
      preset: { ...preset, stepdown: 0.01, stepoverFraction: 0.1 },
    };
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const circle = Array.from({ length: 2000 }, (_, i) => ({
      x: 50 + 50 * Math.cos((2 * Math.PI * i) / 2000),
      y: 50 + 50 * Math.sin((2 * Math.PI * i) / 2000),
    }));
    const runs = {
      pocket: (bottom: number) =>
        pocket({
          ...deep,
          bottom,
          rampAngle: 3,
          boundary: square,
          islands: [],
        }),
      contour: (bottom: number) =>
        contour(
          {
            ...deep,
            bottom,
            loop: circle,
            side: "outside",
            direction: "climb",
            start: [0, 0],
          },
          () => [],
        ),
      facing: (bottom: number) => facing({ ...deep, modelTop: bottom }),
    };
    for (const [name, run] of Object.entries(runs)) {
      const perLevel = run(-0.03).moves.length - run(-0.02).moves.length;
      const error = thrown(() => run(-20));
      const found = new RegExp(
        `^${name} at depth level (\\d+) of 2000 passes the limit of 1,000,000 moves$`,
      ).exec(error instanceof Error ? error.message : "");
      expect(found).not.toBeNull();
      expect(Math.abs(Number(found![1]) - 1_000_000 / perLevel)).toBeLessThan(
        2,
      );
    }
  }, 120_000);
});

const profilesOf = async (of: ServerBody) =>
  (
    (await kernel.moduleJob(
      ENTRY,
      "rockett.cam.features",
      {
        setup: blockSetup,
        bodies: [of].map(({ id, bbox, brep: text, faceNames }) => ({
          id,
          bbox,
          brep: text,
          faceNames,
        })),
      } satisfies FeaturesInput,
      { shouldStop: () => false },
    )) as PlanFeatures
  ).profiles;

const planned = (profile: ProfileFeature, fixtures: Fixture[] = []) => ({
  setups: [
    {
      id: "s1",
      name: "Setup 1",
      ...blockSetup,
      safeHeight: 15,
      clearance: 3,
      ...(fixtures.length && { fixtures }),
      operations: [
        {
          id: "contour",
          type: "rockett.cam.contour",
          name: profile.name,
          toolId: "t1",
          presetId: "p1",
          params: {
            face: profile.face,
            side: profile.side,
            bottomOffset: 0,
            ...(profile.side === "inside" && { opening: profile.opening }),
          } as Record<string, unknown>,
        },
      ],
    },
  ],
  tools: [{ ...tool, fluteLength: 30, presets: [preset] }],
});

const bottomPass = (program: Program, z: number) => {
  const moves = program.sections[0]!.moves;
  const plunge = moves.findLastIndex(
    (move) => move.kind === "feed" && move.role === "plunge",
  );
  const start = moves[plunge]!;
  const pass = moves
    .slice(plunge + 1)
    .filter((move) => move.kind === "feed" || move.kind === "arc");
  if (start.kind !== "feed") throw new Error("no plunge");
  expect(Math.abs(start.to[2] - z)).toBeLessThanOrEqual(0.01);
  for (const move of pass)
    expect(Math.abs(move.to[2] - z)).toBeLessThanOrEqual(0.01);
  expect(pass.at(-1)!.to).toEqual(start.to);
  return pass.map(({ to }) => [to[0], to[1]] as const);
};

const outside = (
  [x, y]: readonly [number, number],
  [x0, y0, x1, y1]: number[],
) => Math.hypot(Math.max(x0! - x, 0, x - x1!), Math.max(y0! - y, 0, y - y1!));

const inside = (
  [x, y]: readonly [number, number],
  [x0, y0, x1, y1]: number[],
) => Math.min(x - x0!, x1! - x, y - y0!, y1! - y);

const clamp = (name: string, min: number[], max: number[]) =>
  ({ name, min, max }) as Fixture;

describe("planned profile contours through rockett.cam.generate", () => {
  it("cuts a closed pass around the outline at the bottom Z", async () => {
    const block = featureBlock();
    const [outline] = await profilesOf(block);
    expect(outline).toMatchObject({ side: "outside" });
    const { program } = await (
      await route(() => block)
    )(planned(outline!), "contour");
    expect(validateProgram(program)).toEqual([]);
    const pass = bottomPass(program, outline!.z);
    expect(pass.length).toBeGreaterThan(4);
    for (const point of pass)
      expect(Math.abs(outside(point, [0, 0, 80, 60]) - 2)).toBeLessThanOrEqual(
        0.01,
      );
  }, 120_000);

  it("cuts a closed pass inside the opening at the bottom Z", async () => {
    const block = openedBlock();
    const [opening] = await profilesOf(block);
    expect(opening).toMatchObject({ side: "inside" });
    const generate = await route(() => block);
    const { program } = await generate(planned(opening!), "contour");
    expect(validateProgram(program)).toEqual([]);
    for (const at of [undefined, 1]) {
      const unnamed = planned(opening!);
      unnamed.setups[0]!.operations[0]!.params.opening = at;
      await expect(generate(unnamed, "contour")).rejects.toThrow(
        /inside contour on bottom face f:block:\d+ of body b1 must name one of its openings$/,
      );
    }
    const pass = bottomPass(program, opening!.z);
    expect(pass.length).toBeGreaterThan(3);
    for (const point of pass)
      expect(Math.abs(inside(point, [5, 10, 15, 30]) - 2)).toBeLessThanOrEqual(
        0.01,
      );
  }, 120_000);

  it("refuses a contour that meets a hold-down, naming it", async () => {
    const block = featureBlock();
    const [outline] = await profilesOf(block);
    const generate = await route(() => block);
    await expect(
      generate(
        planned(outline!, [clamp("toe clamp 1", [30, -5, 0], [50, 10, 10])]),
        "contour",
      ),
    ).rejects.toThrow(/3 mm clearance of fixture toe clamp 1$/);
    const { program } = await generate(
      planned(outline!, [clamp("toe clamp 2", [100, 20, 0], [120, 40, 10])]),
      "contour",
    );
    expect(validateProgram(program)).toEqual([]);
  }, 120_000);
});
