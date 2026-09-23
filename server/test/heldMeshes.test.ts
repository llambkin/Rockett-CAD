import { afterAll, beforeAll, expect, it } from "vitest";
import type { BodyPayload, MutationResponse } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { DRAG_BODY, filletDragPart } from "./helpers/perfFixtures.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

let app: TestApp;
let id = "";
let bodies: BodyPayload[] = [];

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
  ({ id } = await app.store.create("drag"));
  await app.store.save({ ...filletDragPart(), id });
  bodies = (await (await app.request(`/api/projects/${id}/evaluate`)).json())
    .bodies;
}, 300_000);
afterAll(() => app.close());

const drag = async (radius: number, body: object, revision?: number) =>
  app.request(`/api/projects/${id}/features/drag`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"${revision ?? (await app.store.load(id)).revision}"`,
    },
    body: JSON.stringify({ feature: { radius }, ...body }),
  });

const withArrays = (m: MutationResponse) =>
  m.evaluation.bodies.filter((b) => "positions" in b).map((b) => b.bodyId);

it(
  "sends arrays only for the body a fillet changed when the client holds every mesh",
  { timeout: 120_000 },
  async () => {
    expect(bodies).toHaveLength(1000);
    const res = await drag(0.6, { held: bodies.map((b) => b.meshKey) });
    expect(res.status).toBe(200);
    const m: MutationResponse = await res.json();
    expect(withArrays(m)).toEqual([DRAG_BODY]);
    const kept = m.evaluation.bodies.find((b) => b.bodyId === "b:box");
    const before = bodies.find((b) => b.bodyId === "b:box")!;
    expect(kept).toEqual({
      bodyId: "b:box",
      name: "Body1",
      visible: true,
      meshKey: before.meshKey,
    });
  },
);

it(
  "sends every mesh to a client that holds none",
  { timeout: 120_000 },
  async () => {
    const m: MutationResponse = await (await drag(0.7, {})).json();
    expect(withArrays(m)).toHaveLength(1000);
  },
);

it("rejects held keys that are not strings", async () => {
  const res = await drag(0.8, { held: [5] });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({
    code: "validation",
    detail: "/held/0",
  });
});

it("answers a stale revision with the conflict alone", async () => {
  const res = await drag(0.9, { held: bodies.map((b) => b.meshKey) }, 0);
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body).toMatchObject({ code: "conflict" });
  expect(body).not.toHaveProperty("evaluation");
});
