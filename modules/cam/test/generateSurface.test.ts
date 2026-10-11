import { serverRegister } from "./helpers/serverRegister.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CadDocument, ServerBody, User } from "@rockett/plugin-api";
import cam from "../server.js";
import {
  CAM_EXTENSION,
  generateRoute,
  type CamData,
} from "../src/shared/document.js";
import { validateProgram, type Program } from "../src/shared/ir.js";
import { MIN_TOLERANCE } from "../src/shared/params.js";
import { box, brep, cylinder, fuse, startKernel } from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;
const CENTRE = [30, 30];
const FLOOR = 4;
const LIMIT = /passes the limit of 1,000,000 drop cutter samples/;
const meshes = vi.hoisted(() => ({ count: 0 }));

vi.mock("../src/kernel/surfaceMesh.js", async (original) => {
  const real = await original<typeof import("../src/kernel/surfaceMesh.js")>();
  const job = real.default["rockett.cam.surfaceMesh"]!;
  return {
    ...real,
    default: {
      "rockett.cam.surfaceMesh": (...args: Parameters<typeof job>) => {
        meshes.count++;
        return job(...args);
      },
    },
  };
});

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

const tool = {
  id: "t1",
  name: "6 mm ball",
  kind: "ball" as const,
  diameter: 6,
  fluteLength: 30,
  overallLength: 60,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
  number: 1,
};

const preset = {
  id: "p1",
  name: "Finish",
  rpm: 18000,
  cutFeed: 1200,
  plungeFeed: 300,
  rampFeed: 600,
  stepdown: 2,
  stepoverFraction: 0.2,
  coolant: "off" as const,
};

type Generate = (
  data: CamData,
  operationId: string,
) => Promise<{ program: Program }>;

let generate: Generate;

const body = (id: string, text: string): ServerBody => ({
  id,
  name: id,
  bbox: { min: [0, 0, 0], max: [50, 50, 24] } as ServerBody["bbox"],
  brep: text,
  faceNames: [],
  fingerprint: "e".repeat(64),
});
const dirs: string[] = [];

function data(
  params: { parallel?: object; waterline?: object } = {},
  change: Partial<typeof preset> = {},
  bodyId = "boss",
): CamData {
  const op = (id: "parallel" | "waterline", own: object) => ({
    id,
    type: `rockett.cam.${id}`,
    name: id,
    toolId: "t1",
    presetId: "p1",
    params: { angle: 30, tolerance: 0.01, ...own, ...params[id] },
  });
  return {
    setups: [
      {
        id: "s1",
        name: "Setup 1",
        bodies: [bodyId],
        stock: {
          kind: "boxAround",
          margins: { xMin: 5, xMax: 5, yMin: 5, yMax: 5, zMin: 0, zMax: 0 },
        },
        wcs: {
          origin: { kind: "stockCorner", x: "min", y: "min", z: "min" },
          axes: { x: "+x", z: "+z" },
          offsetIndex: 1,
          machine: { kind: "unknown" },
        },
        safeHeight: 15,
        clearance: 3,
        operations: [op("parallel", { angle: 0 }), op("waterline", {})],
      },
    ],
    tools: [{ ...tool, presets: [{ ...preset, ...change }] }],
  };
}

beforeAll(async () => {
  await startKernel();
  const [{ InProcessKernel }, { moduleFiles }, { LocalStorage }] =
    await Promise.all([
      core("kernel/client.ts"),
      core("modules/files.ts"),
      core("store/storage.ts"),
    ]);
  const kernel = new InProcessKernel({ sources: async () => new Map() });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-surface-"));
  dirs.push(dir);
  const boss = brep((own) =>
    fuse(
      own,
      box(own, [0, 0, 0], [50, 50, FLOOR]),
      cylinder(own, [25, 25, FLOOR], [0, 0, 1], 15),
    ),
  );
  const block = brep((own) => box(own, [0, 0, 0], [50, 50, 24]));
  const bodies = [body("boss", boss), body("block", block)];
  const edits = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount({
        projectRoute: () => {},
        userRoute: () => {},
        projectMutation: (r, edit) => edits.set(r.path, edit as never),
      });
      return () => {};
    }),
    startKernelJob: (id: string, input: unknown) =>
      kernel.moduleJob(ENTRY, id, input, { shouldStop: () => false }),
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: moduleFiles(new LocalStorage(dir, fs), "rockett.cam"),
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => bodies,
  });
  generate = (camData, operationId) =>
    edits.get(generateRoute.path)!(
      {
        extensions: { [CAM_EXTENSION]: { version: 1, data: camData } },
      } as unknown as CadDocument,
      { params: { id: "p1" }, body: { setupId: "s1", operationId } },
      { user: mark },
    ) as Promise<{ program: Program }>;
}, 120_000);

afterAll(() =>
  Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))),
);

function loops(program: Program) {
  const found: { z: number; points: number[][] }[] = [];
  for (const move of program.sections[0]!.moves) {
    if (move.kind !== "feed") continue;
    if (move.role === "plunge") found.push({ z: move.to[2], points: [] });
    if (move.role === "cut") found.at(-1)!.points.push(move.to);
  }
  return found;
}

async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("parallel and waterline through rockett.cam.generate", () => {
  it("returns parallel and waterline programs for a 30 mm boss that pass validateProgram", async () => {
    for (const id of ["parallel", "waterline"]) {
      const before = meshes.count;
      const { program } = await generate(data(), id);
      expect(meshes.count).toBe(before + 1);
      expect(validateProgram(program)).toEqual([]);
      expect(program.sections.map((s) => s.operationId)).toEqual([id]);
      expect(program.sections[0]!.moves.length).toBeGreaterThan(10);
    }
  }, 120_000);

  it(`refuses a tolerance below ${MIN_TOLERANCE} mm or a bad wall angle before meshing`, async () => {
    const before = meshes.count;
    for (const id of ["parallel", "waterline"])
      expect(
        await refusal(
          generate(data({ [id]: { tolerance: MIN_TOLERANCE / 2 } }), id),
        ),
      ).toBe(`rockett.cam.${id} params: tolerance must be >= ${MIN_TOLERANCE}`);
    expect(
      await refusal(generate(data({ waterline: { angle: 90 } }), "waterline")),
    ).toBe("wall angle must be at least 0 and below 90 degrees");
    expect(meshes.count).toBe(before);
  });

  it("refuses a job past 1,000,000 drop cutter calls, waterline counting across levels", async () => {
    const message = await refusal(
      generate(data({}, { stepdown: 0.02 }, "block"), "waterline"),
    );
    expect(message).toMatch(LIMIT);
    const [, level, levels] =
      /waterline at depth level (\d+) of (\d+)/.exec(message) ?? [];
    expect(Number(level)).toBeGreaterThan(1);
    expect(Number(level)).toBeLessThan(Number(levels));
  }, 120_000);

  it("keeps the boss wall loop on a floor at 4.0 mm", async () => {
    const { program } = await generate(data(), "waterline");
    const floor = loops(program).filter(
      ({ z }) => z > FLOOR && z - FLOOR < 0.01,
    );
    expect(floor).toHaveLength(1);
    for (const [x, y] of floor[0]!.points)
      expect(Math.hypot(x! - CENTRE[0]!, y! - CENTRE[1]!)).toBeCloseTo(18, 1);
  }, 120_000);
});
