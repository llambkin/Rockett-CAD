import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type BodyPayload,
  type EvaluateResult,
  type WireEvaluateResult,
} from "@rockett/shared";
import { manyBodyPayloads } from "./helpers/perfFixtures";

let api: (typeof import("../src/api"))["api"];
const sent: unknown[] = [];
const headers: unknown[] = [];
const replies: Array<(value: Response) => void> = [];

beforeEach(async () => {
  vi.resetModules();
  ({ api } = await import("../src/api"));
  sent.length = 0;
  headers.length = 0;
  replies.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      sent.push(
        init.body === undefined ? undefined : JSON.parse(`${init.body}`),
      );
      headers.push(init.headers);
      return new Promise<Response>((resolve) => replies.push(resolve));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const document = createEmptyDocument("p", "p");

function evaluation(bodies: BodyPayload[]): EvaluateResult {
  return { bodies, featureStatuses: [], sketches: [], planes: [], kernelMs: 1 };
}

function wire(bodies: BodyPayload[], held: string[]): WireEvaluateResult {
  return {
    ...evaluation([]),
    bodies: bodies.map(({ bodyId, name, visible, meshKey, ...mesh }) =>
      held.includes(meshKey)
        ? { bodyId, name, visible, meshKey }
        : { bodyId, name, visible, meshKey, ...mesh },
    ),
  };
}

function reply(index: number, body: unknown) {
  replies[index]!(Response.json(body));
}

const changed = (body: BodyPayload): BodyPayload => ({
  ...body,
  meshKey: `${body.meshKey}:fillet`,
  positions: body.positions.map((p) => p + 1),
});

it("refills held meshes into the same payloads a full response carries", async () => {
  const bodies = manyBodyPayloads(10, 10);
  const opened = api.evaluate("p");
  reply(0, evaluation(bodies));
  await opened;

  const after = bodies.map((b, i) =>
    i === 7 ? changed(b) : { ...b, name: `Renamed ${i}` },
  );
  const dragged = api.updateFeature("p", "drag", { name: "r" });
  expect(sent[1]).toEqual({
    feature: { name: "r" },
    held: bodies.map((b) => b.meshKey),
  });
  const onWire = wire(
    after,
    bodies.map((b) => b.meshKey),
  );
  expect(onWire.bodies.filter((b) => "positions" in b)).toHaveLength(1);
  reply(1, { document, evaluation: onWire });
  expect((await dragged).evaluation).toEqual(evaluation(after));

  const next = api.addFeature("p", { ...document.features[0]! } as never);
  expect((sent[2] as { held: string[] }).held).toEqual(
    after.map((b) => b.meshKey),
  );
  reply(2, { document, evaluation: evaluation(after) });
  await next;
});

it("refills each response from the meshes held when it was sent", async () => {
  const [a, b] = manyBodyPayloads(2, 1) as [BodyPayload, BodyPayload];
  const opened = api.evaluate("p");
  reply(0, evaluation([a, b]));
  await opened;

  const older = api.updateFeature("p", "drag", {});
  const newer = api.updateFeature("p", "drag", {});
  const c = changed(b);
  reply(2, { document, evaluation: wire([a, c], [a.meshKey]) });
  expect((await newer).evaluation).toEqual(evaluation([a, c]));
  reply(1, { document, evaluation: wire([a, b], [a.meshKey, b.meshKey]) });
  expect((await older).evaluation).toEqual(evaluation([a, b]));
});

it("sends every mesh back to a client that held none", async () => {
  const bodies = manyBodyPayloads(2, 1);
  const first = api.setTimeline("p", 1);
  expect(sent[0]).toEqual({ position: 1, held: [] });
  reply(0, { document, evaluation: evaluation(bodies) });
  expect((await first).evaluation).toEqual(evaluation(bodies));
});

it("keeps its meshes through a conflict and sends them with the revision", async () => {
  const bodies = manyBodyPayloads(2, 1);
  const keys = bodies.map((b) => b.meshKey);
  const first = api.setTimeline("p", 1);
  reply(0, {
    document: { ...document, revision: 4 },
    evaluation: evaluation(bodies),
  });
  await first;

  const refused = api.updateFeature("p", "drag", {});
  expect(headers[1]).toMatchObject({ "If-Match": '"4"' });
  expect((sent[1] as { held: string[] }).held).toEqual(keys);
  replies[1]!(
    Response.json(
      { error: "changed", code: "conflict", revision: 5 },
      { status: 409 },
    ),
  );
  await expect(refused).rejects.toMatchObject({ status: 409, revision: 5 });

  const retried = api.updateFeature("p", "drag", {});
  expect((sent[2] as { held: string[] }).held).toEqual(keys);
  reply(2, {
    document: { ...document, revision: 6 },
    evaluation: wire(bodies, keys),
  });
  expect((await retried).evaluation).toEqual(evaluation(bodies));
});

it("keeps the meshes of the current timeline through an earlier peek", async () => {
  const bodies = manyBodyPayloads(2, 1);
  const opened = api.evaluate("p");
  reply(0, evaluation(bodies));
  await opened;
  const peek = api.evaluate("p", 1);
  reply(1, evaluation([]));
  await peek;

  void api.updateFeature("p", "drag", {});
  expect((sent[2] as { held: string[] }).held).toEqual(
    bodies.map((b) => b.meshKey),
  );
});
