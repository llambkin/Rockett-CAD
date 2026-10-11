import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Placement, type BodyPayload } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import { BlobStore } from "../../../server/src/store/blobStore.js";
import { backupNamespace } from "../../../server/src/store/jsonStore.js";
import manifest from "../manifest.json";
import server from "../server.js";
import { modelPlacement } from "../src/shared/models.js";

const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../server/src/geometry/xde.js", async (original) => {
  const actual =
    await original<typeof import("../../../server/src/geometry/xde.js")>();
  return {
    ...actual,
    readXdeStep: (...args: Parameters<typeof actual.readXdeStep>) => {
      reads.count += 1;
      return actual.readXdeStep(...args);
    },
  };
});

const wedge = readFileSync(
  new URL(
    "fixtures/reference/source/models/fixture-wedge-a.step",
    import.meta.url,
  ),
);
const WEDGE = "${KIPRJMOD}/models/fixture-wedge-a.step";
const WEDGE_POINTS: [number, number, number][] = [0, 2].flatMap((z) =>
  [
    [0, 0],
    [8, 0],
    [1, 3],
  ].map(([x, y]): [number, number, number] => [x!, y!, z]),
);
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const model = (path: string, offset = "0 0 0", rotate = "0 0 0") =>
  `(model "${path}" (offset (xyz ${offset})) (scale (xyz 1 1 1)) (rotate (xyz ${rotate})))`;
const footprint = (
  n: number,
  at: string,
  layer: string,
  models: string[],
  courtyard = "",
) => `(footprint "part" (layer "${layer}") (at ${at})
    (uuid "${uuid(n)}")
    (property "Reference" "U${n}" (at 0 0) (layer "F.SilkS"))
    ${courtyard}
    ${models.join(" ")})`;
const board = (footprints: string[]) =>
  `(kicad_pcb (version 20241229) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 120 80) (layer "Edge.Cuts") (width 0.05))
  ${footprints.join("\n  ")})`;

const at = (n: number) =>
  `${10 + (n % 10) * 10} ${10 + Math.floor(n / 10) * 12}`;
const hand = ([x, y, z]: [number, number, number]) => [
  22 - x,
  y - 9,
  -0.55 - z,
];

let close = async () => {};
afterEach(async () => {
  vi.restoreAllMocks();
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
  const add = async (linkId: string) =>
    expect(
      (
        await send("POST", "/features", {
          feature: {
            id: "board",
            name: "Board",
            suppressed: false,
            type: "rockett.kicad.board",
            version: 1,
            params: {
              linkId,
              placement: { rotation: [0, 0, 0, 1], translation: [0, 0, 0] },
              options: {},
            },
          },
        })
      ).status,
    ).toBe(200);
  const putModel = (linkId: string, name: string, bytes = wedge) =>
    send("POST", `/m/rockett/kicad/models/${linkId}`, {
      name,
      source: bytes.toString("base64"),
    });
  const listed = async (linkId: string) => {
    const response = await f.request(
      `/projects/${f.doc.id}/m/rockett/kicad/models/${linkId}`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { models: unknown[] }).models;
  };
  return { ...f, upload, add, putModel, listed };
}

const parts = (bodies: BodyPayload[]) =>
  bodies.filter(({ bodyId }) => bodyId.startsWith("rockett.kicad:"));

it("reads a STEP shared by 50 footprints once per evaluation, from a .wrl path, and places each one", async () => {
  const f = await fixture();
  const linkId = await f.upload(
    board(
      Array.from({ length: 50 }, (_, n) =>
        footprint(n, at(n), "F.Cu", [
          model("${KIPRJMOD}/models/fixture-wedge-a.wrl"),
        ]),
      ),
    ),
  );
  await f.add(linkId);
  expect((await f.putModel(linkId, WEDGE)).status).toBe(200);
  const doc = await f.store.load(f.doc.id);
  doc.features[0]!.name = "Board read once";
  reads.count = 0;
  const result = await f.kernel.evaluate(doc);
  expect(reads.count).toBe(1);
  expect(result.featureStatuses.map(({ status }) => status)).toEqual(["ok"]);
  const placed = parts(result.bodies);
  expect(placed).toHaveLength(50);
  expect(placed.every(({ approximate }) => !approximate)).toBe(true);
  expect(placed[13]).toMatchObject({
    bodyId: `rockett.kicad:board:${linkId}:${uuid(13)}`,
    name: "U13",
  });
  const { min, max } = placed[13]!.bbox;
  expect([...min, ...max].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
    40, -22, 1.65, 48, -19, 3.65,
  ]);
}, 120_000);

it("places a back-side footprint at angle 90 by the hand-computed matrix within 1e-6", async () => {
  const back = { x: 20, y: -10, angle: 90, side: "back" as const };
  const wedgeModel = {
    path: WEDGE,
    offset: [1, 2, 0.5] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    rotate: [0, 0, 90] as [number, number, number],
  };
  const { placement, scale } = modelPlacement(back, wedgeModel, 1.6);
  expect(scale).toBe(1);
  for (const point of [
    ...WEDGE_POINTS,
    [0.3, -0.7, 5] as [number, number, number],
  ]) {
    const got = Placement.applyToPoint(placement, point);
    hand(point).forEach((value, axis) =>
      expect(Math.abs(got[axis]! - value)).toBeLessThan(1e-6),
    );
  }

  const f = await fixture();
  const linkId = await f.upload(
    board([
      footprint(1, "20 10 90", "B.Cu", [model(WEDGE, "1 2 0.5", "0 0 90")]),
    ]),
  );
  await f.add(linkId);
  expect((await f.putModel(linkId, WEDGE)).status).toBe(200);
  const doc = await f.store.load(f.doc.id);
  const result = await f.kernel.evaluate(doc);
  const [body] = parts(result.bodies);
  const mapped = WEDGE_POINTS.map(hand);
  const corner = (pick: (...values: number[]) => number) =>
    [0, 1, 2].map((axis) => pick(...mapped.map((point) => point[axis]!)));
  const { min, max } = body!.bbox;
  [...min, ...max].forEach((value, i) =>
    expect(
      Math.abs(value - [...corner(Math.min), ...corner(Math.max)][i]!),
    ).toBeLessThan(1e-6),
  );
  const { items } = await f.kernel.stateQuery(doc, {
    kind: "measure",
    request: { refs: [{ kind: "body", bodyId: body!.bodyId }] },
  });
  expect(items[0]?.volume).toBeCloseTo(24, 6);
}, 120_000);

it.each([
  ["traversal", "${KIPRJMOD}/models/../../etc/a.step", "leaves its root"],
  ["escaped substitution", "${KIPRJMOD}/%24%7BHOME%7D/a.step", "escaped"],
  ["unknown substitution", "${HOME}/models/a.step", "unknown substitution"],
  ["URL", "https://example.com/a.step", "URL"],
  ["unreferenced name", "${KIPRJMOD}/models/other.step", "No footprint"],
])(
  "refuses a %s model name before storage and lists a footprint path like it as refused",
  async (kind, name, reason) => {
    const f = await fixture();
    const footprintPath = kind === "unreferenced name" ? WEDGE : name;
    const linkId = await f.upload(
      board([footprint(1, "20 10", "F.Cu", [model(footprintPath)])]),
    );
    const before = await f.store.load(f.doc.id);
    const put = vi.spyOn(BlobStore.prototype, "put");
    const response = await f.putModel(linkId, name);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(reason);
    expect(put).not.toHaveBeenCalled();
    expect(await f.store.load(f.doc.id)).toEqual(before);
    const [entry] = await f.listed(linkId);
    expect(entry).toMatchObject(
      kind === "unreferenced name"
        ? { status: "missing", name: WEDGE }
        : { status: "refused", reason: expect.stringContaining(reason) },
    );
  },
  60_000,
);

it("loads a version 1 link without models, lists every model missing, keeps the placeholder and backs it up before the first version 2 save", async () => {
  const f = await fixture();
  const courtyard = `(fp_rect (start -1 -1) (end 1 1) (layer "F.CrtYd") (width 0.05))`;
  const linkId = await f.upload(
    board([
      footprint(1, "20 10", "F.Cu", [model(WEDGE)], courtyard),
      footprint(2, "40 10", "F.Cu", [
        model("${KICAD9_3DMODEL_DIR}/Package.3dshapes/Part.wrl"),
        model("${KICAD10_3DMODEL_DIR}/Package.3dshapes/Part.step"),
      ]),
    ]),
  );
  await f.add(linkId);
  const doc = await f.store.load(f.doc.id);
  const own = doc.extensions["rockett.kicad"]!;
  own.version = 1;
  expect(
    Object.values((own.data as { links: object }).links)[0],
  ).not.toHaveProperty("models");
  await f.store.save(doc, f.owner.user.id);
  const v1 = structuredClone((await f.store.load(f.doc.id)).extensions);

  expect(await f.listed(linkId)).toEqual([
    {
      footprintUuid: uuid(1),
      reference: "U1",
      path: WEDGE,
      status: "missing",
      name: WEDGE,
    },
    {
      footprintUuid: uuid(2),
      reference: "U2",
      path: "${KICAD9_3DMODEL_DIR}/Package.3dshapes/Part.wrl",
      status: "missing",
      name: "${KICAD9_3DMODEL_DIR}/Package.3dshapes/Part.step",
    },
    {
      footprintUuid: uuid(2),
      reference: "U2",
      path: "${KICAD10_3DMODEL_DIR}/Package.3dshapes/Part.step",
      status: "missing",
      name: "${KICAD10_3DMODEL_DIR}/Package.3dshapes/Part.step",
    },
  ]);
  const placeholder = parts(
    (await f.kernel.evaluate(await f.store.load(f.doc.id))).bodies,
  );
  expect(
    placeholder.map(({ name, approximate }) => [name, approximate]),
  ).toEqual([["U1", true]]);

  const backups = backupNamespace(f.storage, f.store.documents.dir(f.doc.id));
  expect(await backups.names()).toEqual([]);
  const saved = await f.putModel(linkId, WEDGE);
  expect(saved.status).toBe(200);
  const { sha256 } = (await saved.json()) as { sha256: string };
  const after = (await f.store.load(f.doc.id)).extensions["rockett.kicad"]!;
  expect(after.version).toBe(2);
  expect(
    (after.data as { links: Record<string, { models: object }> }).links[linkId]!
      .models,
  ).toEqual({ [WEDGE]: sha256 });
  expect((await f.listed(linkId))[0]).toMatchObject({
    status: "uploaded",
    sha256,
  });
  const names = await backups.names();
  expect(names).toEqual([
    expect.stringMatching(/^rockett\.kicad\.v1\.v2-[0-9a-f]{16}$/),
  ]);
  await backups.restore(names[0]!);
  expect((await f.store.load(f.doc.id)).extensions).toEqual(v1);
}, 60_000);
