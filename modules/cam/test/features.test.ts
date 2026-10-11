import { serverRegister } from "./helpers/serverRegister.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { CadDocument, ServerBody, User } from "@rockett/plugin-api";
import cam from "../server.js";
import type { FeaturesInput } from "../src/kernel/features.js";
import type { PlanFeatures } from "../src/plan/plan.js";
import {
  CAM_EXTENSION,
  featuresRoute,
  type CamData,
} from "../src/shared/document.js";
import {
  blockSetup as setup,
  featureBlock,
  openedBlock,
} from "./helpers/blocks.js";
import { moduleJob, startKernel } from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-06T00:00:00.000Z",
  modifiedAt: "2026-10-06T00:00:00.000Z",
};

let body: ServerBody;

beforeAll(async () => {
  await startKernel();
  body = featureBlock();
}, 120_000);

const features = (of = body) =>
  moduleJob(ENTRY, "rockett.cam.features", {
    setup,
    bodies: [of].map(({ id, bbox, brep: text, faceNames }) => ({
      id,
      bbox,
      brep: text,
      faceNames,
    })),
  } satisfies FeaturesInput) as Promise<PlanFeatures>;

type Read = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<unknown>;

async function featuresRead() {
  const reads = new Map<string, Read>();
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount({
        projectRoute: (r, read) => reads.set(r.path, read as Read),
        userRoute: () => {},
        projectMutation: () => {},
      });
      return () => {};
    }),
    startKernelJob: (id: string, input: unknown) => moduleJob(ENTRY, id, input),
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: undefined!,
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => [body],
  });
  const data: CamData = {
    setups: [{ id: "s1", name: "Setup 1", ...setup }],
    tools: [],
  };
  return (setupId: string) =>
    reads.get(featuresRoute.path)!(
      {
        extensions: { [CAM_EXTENSION]: { version: 1, data } },
      } as unknown as CadDocument,
      { params: { id: "p1", setupId } },
      { user: mark },
    );
}

const near = (value: number, expected: number) =>
  expect(Math.abs(value - expected)).toBeLessThanOrEqual(0.01);

describe("rockett.cam.features", () => {
  it("finds the pocket, the through hole and the outside outline of a block", async () => {
    const found = await features();
    expect(found.stockTop).toBeCloseTo(0, 9);
    expect(found.stockOutline).toEqual({ min: [0, 0], max: [80, 60] });
    expect(found.modelTop).toBeCloseTo(-2, 6);
    expect(found.pockets).toHaveLength(1);
    const [pocket] = found.pockets;
    near(pocket!.width, 20);
    near(pocket!.cornerRadius, 3);
    const { min, max } = pocket!.footprint;
    [...min, ...max].forEach((v, i) => near(v, [10, 10, 30, 40][i]!));
    expect(pocket!.z).toBeCloseTo(-10, 6);
    expect(pocket!.floor.bodyId).toBe("b1");
    expect(pocket!.floor.sig.point[2]).toBeCloseTo(12, 6);
    expect(pocket!.floor.sig.direction[2]).toBeCloseTo(1, 9);
    expect(found.holes).toHaveLength(1);
    expect(found.holes[0]!.diameter).toBeCloseTo(6, 6);
    expect(found.holes[0]!.blocked).toBe(false);
    expect(found.profiles).toHaveLength(1);
    expect(found.profiles[0]).toMatchObject({ side: "outside" });
    expect(found.profiles[0]!.z).toBeCloseTo(-22, 6);
    const outline = found.profiles[0]!.footprint;
    [...outline.min, ...outline.max].forEach((v, i) =>
      near(v, [0, 0, 80, 60][i]!),
    );
  }, 120_000);

  it("returns the same features for the setup through the route", async () => {
    const read = await featuresRead();
    expect(await read("s1")).toEqual(await features());
    expect(await read("s9")).toEqual({
      reason: "setup s9 is not in this project",
    });
  }, 120_000);

  it("leaves out an undercut floor and an outline the body overhangs, and finds a through opening", async () => {
    const found = await features(openedBlock());
    expect(found.pockets).toEqual([]);
    expect(found.holes).toEqual([]);
    expect(found.profiles).toHaveLength(1);
    const [opening] = found.profiles;
    expect(opening).toMatchObject({ side: "inside", cornerRadius: 0 });
    near((opening as { width: number }).width, 10);
    const hole = opening!.footprint;
    [...hole.min, ...hole.max].forEach((v, i) => near(v, [5, 10, 15, 30][i]!));
    expect(opening!.z).toBeCloseTo(-12, 6);
  }, 120_000);
});
