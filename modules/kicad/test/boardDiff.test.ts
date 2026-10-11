import { afterEach, expect, it, vi } from "vitest";
import {
  meshPayloadOf,
  type CadDocument,
  type EvaluateResult,
} from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import { BlobStore } from "../../../server/src/store/blobStore.js";
import manifest from "../manifest.json";
import server from "../server.js";
import { readBoard } from "../src/board.js";
import { diffBoards } from "../src/diff.js";
import { sourceTree } from "../src/server/upload.js";

const R1 = "00000000-0000-4000-8000-000000000101";
const C1 = "00000000-0000-4000-8000-000000000102";
const U1 = "00000000-0000-4000-8000-000000000103";
const D1 = "00000000-0000-4000-8000-000000000104";

type Part = {
  uuid: string;
  reference: string;
  at: string;
  layer?: "F.Cu" | "B.Cu";
  model?: string;
};
const part = ({ uuid, reference, at, layer = "F.Cu", model }: Part) => {
  const yard = layer === "F.Cu" ? "F.CrtYd" : "B.CrtYd";
  return `(footprint "part" (layer "${layer}") (at ${at})
    (uuid "${uuid}")
    (property "Reference" "${reference}" (at 0 0) (layer "F.SilkS"))
    (fp_rect (start -2 -1) (end 2 1) (layer "${yard}") (width 0.05))
    ${model ? `(model "${model}" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))` : ""})`;
};
const r1 = { uuid: R1, reference: "R1", at: "10 10" };
const c1 = { uuid: C1, reference: "C1", at: "30 10" };
const u1 = { uuid: U1, reference: "U1", at: "20 20" };
const d1 = { uuid: D1, reference: "D1", at: "40 20" };
const board = (parts: Part[], { thickness = 1.6, width = 50 } = {}) =>
  `(kicad_pcb (version 20241229) (general (thickness ${thickness}))
  (gr_rect (start 0 0) (end ${width} 30) (layer "Edge.Cuts") (width 0.05))
  ${parts.map(part).join("\n  ")})`;
const snapshot = (source: string) => readBoard(sourceTree(Buffer.from(source)));

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
  const upload = (source: string, linkId?: string) =>
    send("POST", "/m/rockett/kicad/upload", {
      source: Buffer.from(source).toString("base64"),
      ...(linkId && { linkId }),
    });
  const edit = async (method: string, url: string, body: unknown = {}) => {
    const response = await send(method, url, body);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      document: CadDocument;
      evaluation: EvaluateResult;
    };
  };
  return { ...f, upload, edit };
}

const own = (doc: CadDocument) => ({
  extension: doc.extensions["rockett.kicad"],
  assets: doc.moduleAssets?.namespaces["rockett.kicad"],
});
const parts = ({ bodies }: EvaluateResult) =>
  bodies
    .filter(({ bodyId }) => bodyId.startsWith("rockett.kicad:"))
    .map(({ bodyId, name }) => [bodyId, name]);
const statuses = ({ featureStatuses }: EvaluateResult) =>
  featureStatuses.map(({ featureId, status, refs }) => ({
    featureId,
    status,
    refs: refs?.map(({ status: found, ref }) => [found, ref.bodyId]),
  }));

it("lists added, removed, moved, rotated, side-swapped, model, outline and thickness changes by footprint uuid", () => {
  const before = snapshot(
    board([r1, c1, u1, { ...d1, model: "${KIPRJMOD}/models/a.step" }]),
  );
  expect(diffBoards(before, before)).toEqual({
    added: [],
    removed: [],
    moved: [],
    modelChanged: [],
    outlineChanged: false,
    thicknessChanged: false,
  });
  const after = snapshot(
    board(
      [
        { ...r1, reference: "R7", at: "10 10 90" },
        { ...c1, layer: "B.Cu" },
        { ...d1, model: "${KIPRJMOD}/models/b.step" },
        {
          uuid: "00000000-0000-4000-8000-000000000105",
          reference: "J1",
          at: "5 5",
        },
      ],
      { thickness: 1.2, width: 60 },
    ),
  );
  expect(diffBoards(before, after)).toEqual({
    added: ["00000000-0000-4000-8000-000000000105"],
    removed: [U1],
    moved: [R1, C1],
    modelChanged: [D1],
    outlineChanged: true,
    thicknessChanged: true,
  });
  expect(diffBoards(after, before)).toMatchObject({
    added: [U1],
    removed: ["00000000-0000-4000-8000-000000000105"],
  });
  expect(
    diffBoards(snapshot(board([{ ...r1, at: "11 10" }])), snapshot(board([r1])))
      .moved,
  ).toEqual([R1]);
});

it("updates a link in one undoable step: bodies keep their ids, a removed footprint's reference goes missing, and undo restores the previous snapshot, assets and body ids", async () => {
  const f = await fixture();
  const first = await f.upload(board([r1, c1, u1]));
  expect(first.status).toBe(200);
  const { linkId } = (await first.json()) as { linkId: string };
  const added = await f.edit("POST", "/features", {
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
  });
  const id = (uuid: string) => `rockett.kicad:board:${linkId}:${uuid}`;
  expect(parts(added.evaluation)).toEqual([
    [id(R1), "R1"],
    [id(C1), "C1"],
    [id(U1), "U1"],
  ]);
  const u1Body = added.evaluation.bodies.find(
    ({ bodyId }) => bodyId === id(U1),
  )!;
  const mesh = await f.request(
    `/projects/${f.doc.id}/meshes/${u1Body.mesh!.hash}`,
  );
  expect(mesh.status).toBe(200);
  const [edge] = meshPayloadOf(new Uint8Array(await mesh.arrayBuffer())).edges;
  const referenced = await f.edit("POST", "/features", {
    feature: {
      id: "round",
      name: "Round U1",
      suppressed: false,
      type: "fillet",
      filletType: "equalDistance",
      edges: [{ kind: "edge", bodyId: id(U1), edgeName: edge!.name }],
      radius: 0.2,
    },
  });
  expect(statuses(referenced.evaluation)).toEqual([
    { featureId: "board", status: "ok", refs: undefined },
    { featureId: "round", status: "ok", refs: undefined },
  ]);
  const before = own(await f.store.load(f.doc.id));

  const put = vi.spyOn(BlobStore.prototype, "put");
  const absent = await f.upload(board([r1]), "not-a-link");
  expect(absent.status).toBe(422);
  expect(put).not.toHaveBeenCalled();
  expect(own(await f.store.load(f.doc.id))).toEqual(before);

  const updated = await f.upload(
    board(
      [
        { ...r1, at: "10 10 90" },
        { ...c1, layer: "B.Cu" },
      ],
      {
        thickness: 1.2,
      },
    ),
    linkId,
  );
  expect(updated.status).toBe(200);
  const result = (await updated.json()) as {
    linkId: string;
    diff: unknown;
    document: CadDocument;
    evaluation: EvaluateResult;
  };
  expect(result.linkId).toBe(linkId);
  expect(result.diff).toEqual({
    added: [],
    removed: [U1],
    moved: [R1, C1],
    modelChanged: [],
    outlineChanged: false,
    thicknessChanged: true,
  });
  type Links = Record<string, { snapshotAsset: string; outlineOwner: string }>;
  const links = (extension: unknown) =>
    (extension as { data: { links: Links } }).data.links;
  const previous = links(before.extension)[linkId]!;
  const now = links(result.document.extensions["rockett.kicad"])[linkId]!;
  expect(
    Object.keys(links(result.document.extensions["rockett.kicad"])),
  ).toEqual([linkId]);
  expect(now.snapshotAsset).not.toBe(previous.snapshotAsset);
  expect(now.outlineOwner).toBe("kicad");
  expect(result.document.moduleAssets!.namespaces["rockett.kicad"]).toContain(
    now.snapshotAsset,
  );
  expect(
    await (await f.request(`/projects/${f.doc.id}/history`)).text(),
  ).toContain("Update KiCad board");

  const live = await f.kernel.evaluate(await f.store.load(f.doc.id));
  expect(parts(live)).toEqual([
    [id(R1), "R1"],
    [id(C1), "C1"],
  ]);
  expect(statuses(live)).toEqual([
    { featureId: "board", status: "ok", refs: undefined },
    { featureId: "round", status: "error", refs: [["missing", id(U1)]] },
  ]);

  await f.edit("POST", "/undo");
  const undone = await f.store.load(f.doc.id);
  expect(own(undone)).toEqual(before);
  const restored = await f.kernel.evaluate(undone);
  expect(parts(restored)).toEqual(parts(added.evaluation));
  expect(statuses(restored)).toEqual(statuses(referenced.evaluation));

  await f.edit("POST", "/redo");
  const readded = await f.upload(board([r1, c1, u1]), linkId);
  expect(readded.status).toBe(200);
  expect(((await readded.json()) as { diff: unknown }).diff).toMatchObject({
    added: [U1],
    removed: [],
  });
  const back = await f.kernel.evaluate(await f.store.load(f.doc.id));
  expect(parts(back)).toEqual(parts(added.evaluation));
  expect(statuses(back)).toEqual(statuses(referenced.evaluation));
}, 120_000);
