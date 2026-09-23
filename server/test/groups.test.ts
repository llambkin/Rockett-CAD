import { afterAll, beforeAll, expect, it } from "vitest";
import { initKernel } from "../src/geometry/kernel.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";
import { trackRevisions } from "./helpers/revisions.js";

let app: TestApp;
const send = trackRevisions((url, init) => app.request(url, init));

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

async function call(method: string, url: string, body?: unknown) {
  const res = await send(`/api${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json() };
}

async function api(method: string, url: string, body?: unknown) {
  const { status, json } = await call(method, url, body);
  expect(status, JSON.stringify(json)).toBe(200);
  return json;
}

async function twoBodies() {
  const { document } = await api("POST", "/projects", { name: "Groups" });
  const url = `/projects/${document.id}`;
  await api("POST", `${url}/features`, {
    feature: {
      id: "sk",
      type: "sketch",
      name: "Sketch",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [
        { id: "p", kind: "point", x: 0, y: 0 },
        { id: "c", kind: "circle", center: "p", radius: 5 },
        { id: "q", kind: "point", x: 40, y: 0 },
        { id: "d", kind: "circle", center: "q", radius: 5 },
      ],
      constraints: [],
    },
  });
  const { sketches } = await api("GET", `${url}/evaluate`);
  for (const [i, profile] of sketches[0].profiles.entries())
    await api("POST", `${url}/features`, {
      feature: {
        id: `ext${i}`,
        type: "extrude",
        name: "",
        suppressed: false,
        profiles: [{ sketchId: "sk", profileId: profile.id }],
        distance: 5,
        direction: "normal",
        operation: "newBody",
      },
    });
  return url;
}

const group = (members: string[], kind = "body") => ({
  id: "g1",
  name: "Group 1",
  kind,
  members,
});

it("saves groups without changing evaluation and drops a body that vanishes", async () => {
  const url = await twoBodies();
  const before = await api("GET", `${url}/evaluate`);
  const saved = await api("PUT", `${url}/groups`, {
    groups: [group(["b:ext0", "b:ext1"])],
  });
  expect(saved.document.groups).toEqual([group(["b:ext0", "b:ext1"])]);
  expect(saved.evaluation.bodies).toEqual(before.bodies);

  const rolled = await api("POST", `${url}/timeline`, { position: 2 });
  expect(rolled.evaluation.bodies).toHaveLength(1);
  expect(rolled.document.groups[0].members).toEqual(["b:ext0", "b:ext1"]);
  await api("POST", `${url}/timeline`, { position: 3 });

  const deleted = await api("DELETE", `${url}/features/ext1`);
  expect(deleted.document.groups).toEqual([group(["b:ext0"])]);
  const empty = await api("DELETE", `${url}/features/ext0`);
  expect(empty.document.groups).toEqual([group([])]);
  expect((await api("GET", url)).document.groups).toEqual([group([])]);
});

it("drops a deleted sketch from its group", async () => {
  const url = await twoBodies();
  await api("PUT", `${url}/groups`, { groups: [group(["sk"], "sketch")] });
  await api("DELETE", `${url}/features/ext0`);
  await api("DELETE", `${url}/features/ext1`);
  const m = await api("DELETE", `${url}/features/sk`);
  expect(m.document.groups).toEqual([group([], "sketch")]);
});

it("rejects malformed groups and saves nothing", async () => {
  const url = await twoBodies();
  for (const groups of [
    [group(["b:ext0"], "part")],
    [{ ...group(["b:ext0"]), name: "" }],
    [group(["b:ext0"]), { ...group(["b:ext0"]), id: "g2" }],
    [group(["b:ext0"]), group(["b:ext1"])],
    [group(["b:ext0", "b:ext0"])],
  ]) {
    const { status } = await call("PUT", `${url}/groups`, { groups });
    expect(status, JSON.stringify(groups)).toBe(400);
  }
  expect((await api("GET", url)).document.groups).toEqual([]);
});
