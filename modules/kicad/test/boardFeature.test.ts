import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import {
  meshBinary,
  meshPayloadOf,
  type CadDocument,
  type FaceInfo,
} from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import type { KernelClient } from "../../../server/src/kernel/client.js";
import { WorkerKernel } from "../../../server/src/kernel/workerKernel.js";
import { loadModules } from "../../../server/src/modules/host.js";
import manifest from "../manifest.json";
import server from "../server.js";

const reference = readFileSync(
  new URL("fixtures/reference/source/reference.kicad_pcb", import.meta.url),
  "utf8",
);
const SAME = { rotation: [0, 0, 0, 1], translation: [0, 0, 0] };
const mounts = [101, 102, 103, 104].map(
  (n) => `drill:00000000-0000-4000-8000-000000000${n}:0:0`,
);
const slotted = `(kicad_pcb (version 20241229) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 40 20) (layer "Edge.Cuts") (width 0.05))
  (gr_circle (center 30 10) (end 32 10) (layer "Edge.Cuts") (width 0.05))
  (footprint "slot" (layer "F.Cu") (at 10 10)
    (uuid "00000000-0000-4000-8000-000000000301")
    (pad "1" np_thru_hole oval (at 0 0 90) (size 1 3) (drill oval 1 3) (layers "*.Cu"))
    (pad "2" smd rect (at 3 0) (size 1 1) (layers "F.Cu"))))`;

const params = (linkId: string, placement: unknown = SAME) => ({
  linkId,
  placement,
  options: {},
});

let close = async () => {};
afterEach(async () => {
  await close();
  close = async () => {};
});

async function fixture() {
  const f = await moduleProjectFixture({ id: "fixture.empty", mount() {} });
  f.off();
  let stop = await loadModules(
    [{ manifest, server }],
    f.kernel,
    f.store,
    f.folders,
  );
  f.remount();
  let worker: WorkerKernel | undefined;
  close = async () => {
    stop();
    await worker?.close();
    await f.close();
  };
  const revision = async () => `"${(await f.store.load(f.doc.id)).revision}"`;
  const send = async (method: string, url: string, body: unknown) =>
    f.request(`/projects/${f.doc.id}${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "If-Match": await revision(),
      },
      body: JSON.stringify(body),
    });
  const upload = async (board: string) => {
    const response = await send("POST", "/m/rockett/kicad/upload", {
      source: Buffer.from(board).toString("base64"),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { linkId: string }).linkId;
  };
  const add = (linkId: string) =>
    send("POST", "/features", {
      feature: {
        id: "board",
        name: "Board",
        suppressed: false,
        type: "rockett.kicad.board",
        version: 1,
        params: params(linkId),
      },
    });
  const edit = (linkId: string, placement?: unknown) =>
    send("PUT", "/features/board", {
      feature: { params: params(linkId, placement) },
    });
  const toWorker = async () => {
    stop();
    worker = new WorkerKernel(
      f.store,
      new URL("../../../server/src/kernel/worker.ts", import.meta.url),
      { execArgv: ["--import", "tsx"] },
    );
    stop = await loadModules(
      [{ manifest, server }],
      worker,
      f.store,
      f.folders,
    );
    return worker;
  };
  return { ...f, upload, add, edit, toWorker };
}

async function evaluated(kernel: KernelClient, doc: CadDocument) {
  const result = await kernel.evaluate(doc);
  const body = result.bodies.find(({ bodyId }) => bodyId === "b:board");
  const { items } = body
    ? await kernel.stateQuery(doc, {
        kind: "measure",
        request: { refs: [{ kind: "body", bodyId: "b:board" }] },
      })
    : { items: [] };
  const faces = body ? meshPayloadOf(meshBinary(body)).faces : [];
  return {
    statuses: result.featureStatuses.map(({ status, error }) =>
      error ? `${status}: ${error}` : status,
    ),
    volume: items[0]?.volume ?? Number.NaN,
    names: faces.map(({ name }) => name).toSorted(),
    faces: new Map<string, FaceInfo["surface"]>(
      faces.map(({ name, surface }) => [name, surface]),
    ),
  };
}

const labels = (...names: string[]) =>
  names.map((label) => `f:board:l:${label}`).toSorted();

const near = (value: number, expected: number) =>
  expect(Math.abs(value - expected)).toBeLessThan(1e-3);

it("extrudes a 50 by 30 by 1.6 board with four 3.2 mm holes to its nominal volume with stable face labels across edits, a cold reopen and the worker kernel", async () => {
  const f = await fixture();
  const linkId = await f.upload(reference);
  const thick = await f.upload(
    reference.replace("(thickness 1.6)", "(thickness 2)"),
  );
  expect((await f.add(linkId)).status).toBe(200);

  const named = labels(
    "top",
    "bottom",
    "edge:0",
    "edge:1",
    "edge:2",
    "edge:3",
    ...mounts,
  );
  const first = await evaluated(f.kernel, await f.store.load(f.doc.id));
  expect(first.statuses).toEqual(["ok"]);
  near(first.volume, 2400 - 4 * Math.PI * 1.6 ** 2 * 1.6);
  expect(first.names).toEqual(named);
  const top = first.faces.get("f:board:l:top");
  expect(top?.type === "plane" && top.normal[2]).toBeCloseTo(1, 9);
  expect(top?.type === "plane" && top.origin[2]).toBeCloseTo(1.6, 9);
  const hole = first.faces.get(`f:board:l:${mounts[0]}`);
  expect(hole).toMatchObject({ type: "cylinder" });
  if (hole?.type === "cylinder") {
    expect(hole.radius).toBeCloseTo(1.6, 9);
    expect(hole.origin[0]).toBeCloseTo(5, 9);
    expect(hole.origin[1]).toBeCloseTo(-5, 9);
  }

  const turned = {
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    translation: [10, 0, 5],
  };
  expect((await f.edit(linkId, turned)).status).toBe(200);
  const moved = await evaluated(f.kernel, await f.store.load(f.doc.id));
  expect(moved.names).toEqual(named);
  near(moved.volume, first.volume);
  const lifted = moved.faces.get("f:board:l:top");
  expect(lifted?.type === "plane" && lifted.origin[2]).toBeCloseTo(6.6, 9);

  expect((await f.edit(thick)).status).toBe(200);
  const thicker = await evaluated(f.kernel, await f.store.load(f.doc.id));
  expect(thicker.names).toEqual(named);
  near(thicker.volume, (1500 - 4 * Math.PI * 1.6 ** 2) * 2);

  expect(
    (await f.edit(linkId, { ...SAME, rotation: [0, 0, 0, 2] })).status,
  ).toBe(400);

  f.kernel.drop(f.doc.id);
  const reopened = await f.store.load(f.doc.id);
  const cold = await evaluated(f.kernel, reopened);
  expect(cold.names).toEqual(named);
  near(cold.volume, thicker.volume);
  expect(reopened.namingVersion).toBe(2);
  const v1 = await evaluated(f.kernel, { ...reopened, namingVersion: 1 });
  expect(v1.names).toEqual(named);

  const inWorker = await evaluated(await f.toWorker(), reopened);
  expect(inWorker.statuses).toEqual(["ok"]);
  expect(inWorker.names).toEqual(named);
  near(inWorker.volume, thicker.volume);
}, 120_000);

it("cuts a cutout and a rotated oval slot through the board and labels their walls", async () => {
  const f = await fixture();
  expect((await f.add(await f.upload(slotted))).status).toBe(200);
  const result = await evaluated(f.kernel, await f.store.load(f.doc.id));
  expect(result.statuses).toEqual(["ok"]);
  const slot = [0, 1, 2, 3].map(
    (s) => `drill:00000000-0000-4000-8000-000000000301:0:${s}`,
  );
  expect(result.names).toEqual(
    labels(
      "top",
      "bottom",
      "edge:0",
      "edge:1",
      "edge:2",
      "edge:3",
      "cutout:0:0",
      ...slot,
    ),
  );
  near(result.volume, (800 - 4 * Math.PI - 2 - Math.PI / 4) * 1.6);
  for (const label of slot) {
    const wall = result.faces.get(`f:board:l:${label}`);
    if (wall?.type === "plane") {
      expect(Math.abs(wall.normal[1])).toBeCloseTo(1, 9);
      expect(Math.abs(wall.origin[1] + 10)).toBeCloseTo(0.5, 9);
    } else {
      expect(wall?.type).toBe("cylinder");
      expect(wall?.type === "cylinder" && wall.radius).toBeCloseTo(0.5, 9);
    }
  }
}, 60_000);

it("refuses a board feature whose link is not in the project and keeps the document", async () => {
  const f = await fixture();
  await f.upload(reference);
  const before = await f.store.load(f.doc.id);
  const refused = await f.add("missing");
  expect(refused.status).toBe(422);
  expect((await refused.json()).error).toBe(
    "KiCad board link missing is not in this project",
  );
  expect(await f.store.load(f.doc.id)).toEqual(before);
}, 60_000);

it("refuses a placement quaternion of norm 1.01 through the board feature with the shared placement message", async () => {
  const f = await fixture();
  const linkId = await f.upload(reference);
  expect((await f.add(linkId)).status).toBe(200);
  const before = await f.store.load(f.doc.id);
  const refused = await f.edit(linkId, { ...SAME, rotation: [0, 0, 0, 1.01] });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({
    error: expect.stringMatching(
      /placement\.rotation must be a unit quaternion$/,
    ),
  });
  expect(await f.store.load(f.doc.id)).toEqual(before);
}, 60_000);
