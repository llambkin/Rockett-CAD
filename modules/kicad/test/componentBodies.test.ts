import { afterEach, expect, it } from "vitest";
import type { BodyPayload, CadDocument } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import manifest from "../manifest.json";
import server from "../server.js";

const R1 = "00000000-0000-4000-8000-000000000401";
const C1 = "00000000-0000-4000-8000-000000000402";
const H1 = "00000000-0000-4000-8000-000000000403";
const board = (
  reference: string,
) => `(kicad_pcb (version 20241229) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 40 20) (layer "Edge.Cuts") (width 0.05))
  (footprint "resistor" (layer "F.Cu") (at 10 10)
    (uuid "${R1}")
    (property "Reference" "${reference}" (at 0 -2) (layer "F.SilkS"))
    (fp_rect (start -1 -0.5) (end 1 0.5) (layer "F.CrtYd") (width 0.05))
    (pad "1" smd rect (at -0.5 0) (size 0.5 0.5) (layers "F.Cu")))
  (footprint "capacitor" (layer "B.Cu") (at 30 10)
    (uuid "${C1}")
    (property "Reference" "C1" (at 0 2) (layer "B.SilkS"))
    (fp_rect (start -2 -1) (end 2 1) (layer "B.CrtYd") (width 0.05))
    (pad "1" smd rect (at -1 0) (size 0.5 0.5) (layers "B.Cu")))
  (footprint "mount" (layer "F.Cu") (at 5 5)
    (uuid "${H1}")
    (property "Reference" "H1" (at 0 -2) (layer "F.SilkS"))
    (pad "" np_thru_hole circle (at 0 0) (size 2 2) (drill 2) (layers "*.Cu"))))`;

const params = (linkId: string, translation = [0, 0, 0]) => ({
  linkId,
  placement: { rotation: [0, 0, 0, 1], translation },
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
  const stop = await loadModules(
    [{ manifest, server }],
    f.kernel,
    f.store,
    f.folders,
  );
  f.remount();
  close = async () => {
    stop();
    await f.close();
  };
  const send = async (method: string, url: string, body: unknown) =>
    f.request(`/projects/${f.doc.id}${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
      },
      body: JSON.stringify(body),
    });
  const upload = async (source: string) => {
    const response = await send("POST", "/m/rockett/kicad/upload", {
      source: Buffer.from(source).toString("base64"),
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
  const move = (linkId: string, translation: number[]) =>
    send("PUT", "/features/board", {
      feature: { params: params(linkId, translation) },
    });
  return { ...f, upload, add, move };
}

type Links = Record<string, { snapshotAsset: string }>;
const links = (doc: CadDocument) =>
  (doc.extensions["rockett.kicad"] as { data: { links: Links } }).data.links;

function components(bodies: BodyPayload[]) {
  return bodies
    .filter(({ bodyId }) => bodyId.startsWith("rockett.kicad:"))
    .map(({ bodyId, name, reference, approximate, bbox }) => ({
      bodyId,
      name,
      reference,
      approximate,
      bbox: [...bbox.min, ...bbox.max].map((v) => Math.round(v * 1e6) / 1e6),
    }));
}

it("makes each courtyard a 1 mm approximate reference box keyed by link and footprint uuid, under the board on the back, and renaming R1 to R7 keeps the body id", async () => {
  const f = await fixture();
  const linkId = await f.upload(board("R1"));
  const renamed = await f.upload(board("R7"));
  expect((await f.add(linkId)).status).toBe(200);

  const doc = await f.store.load(f.doc.id);
  const first = await f.kernel.evaluate(doc);
  expect(first.featureStatuses.map(({ status }) => status)).toEqual(["ok"]);
  const r1 = `rockett.kicad:board:${linkId}:${R1}`;
  const c1 = `rockett.kicad:board:${linkId}:${C1}`;
  expect(components(first.bodies)).toEqual([
    {
      bodyId: r1,
      name: "R1",
      reference: true,
      approximate: true,
      bbox: [9, -10.5, 1.6, 11, -9.5, 2.6],
    },
    {
      bodyId: c1,
      name: "C1",
      reference: true,
      approximate: true,
      bbox: [28, -11, -1, 32, -9, 0],
    },
  ]);
  expect(
    first.bodies.find(({ bodyId }) => bodyId === "b:board"),
  ).not.toHaveProperty("reference");

  const resynced = structuredClone(doc);
  links(resynced)[linkId]!.snapshotAsset = links(doc)[renamed]!.snapshotAsset;
  const after = components((await f.kernel.evaluate(resynced)).bodies);
  expect(after.map(({ bodyId, name }) => [bodyId, name])).toEqual([
    [r1, "R7"],
    [c1, "C1"],
  ]);
  expect(after[0]?.bbox).toEqual(components(first.bodies)[0]?.bbox);

  expect((await f.move(linkId, [10, 0, 5])).status).toBe(200);
  const moved = await f.kernel.evaluate(await f.store.load(f.doc.id));
  expect(components(moved.bodies).map(({ bbox }) => bbox)).toEqual([
    [19, -10.5, 6.6, 21, -9.5, 7.6],
    [38, -11, 4, 42, -9, 5],
  ]);
}, 60_000);
