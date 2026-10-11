import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import type { CadDocument } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { toPublicUser } from "../../../server/src/auth/userStore.js";
import { loadModules } from "../../../server/src/modules/host.js";
import { projectServices } from "../../../server/src/modules/services.js";
import { readBoard, readBoardNets } from "../src/board.js";
import { parseSexpr } from "../src/sexpr.js";
import manifest from "../manifest.json";
import server from "../server.js";

const fixtures = new URL("./fixtures/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, fixtures));
const reference = read("reference/source/reference.kicad_pcb");
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const member = (footprint: number, name: string, pad: string) => ({
  footprintUuid: `00000000-0000-4000-8000-${String(footprint).padStart(12, "0")}`,
  reference: name,
  pad,
});
const fixtureNet = [{ name: "fixture-net", members: [member(7, "", "1")] }];
const referenceNets = [
  {
    name: "GND",
    members: [
      member(201, "U1", "1"),
      member(203, "U3", "1"),
      member(204, "J1", "1"),
    ],
  },
  { name: "SIGNAL", members: [member(202, "U2", "1"), member(204, "J1", "2")] },
];
const board = (pads: string, uuid = '(uuid "u")') =>
  parseSexpr(`(kicad_pcb (version 20241229) (general (thickness 1.6))
    (footprint "f" (layer "F.Cu") (at 1 1) ${uuid} ${pads}))`);
const pad = (net: string) =>
  `(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") ${net})`;
type Links = {
  links: Record<
    string,
    { sourceAsset: string; sha256: string; snapshotAsset: string }
  >;
};
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
  const upload = async (
    source: Uint8Array,
    project = f.doc.id,
    identity = f.editor,
  ) => {
    const response = await f.request(
      `/projects/${project}/m/rockett/kicad/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(project)).revision}"`,
        },
        body: JSON.stringify({
          source: Buffer.from(source).toString("base64"),
        }),
      },
      identity,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { linkId: string }).linkId;
  };
  const blobs = new Map<string, Uint8Array>();
  const nets = async (
    input: unknown,
    doc: CadDocument | Promise<CadDocument> = f.store.load(f.doc.id),
  ) => {
    const project = await doc;
    const service = projectServices(project, {
      user: toPublicUser(f.editor.user),
      blobs: {
        get: async (hash) =>
          blobs.get(hash) ??
          Uint8Array.from(await f.store.blob(project.id, hash)),
      },
    }).get("rockett.kicad.boardNets");
    expect(service).toBeTypeOf("function");
    return service!(input);
  };
  const linkOf = (doc: CadDocument, linkId: string) =>
    (doc.extensions["rockett.kicad"]!.data as Links).links[linkId]!;
  const relinked = async (linkId: string, source: Uint8Array | string) => {
    const doc = structuredClone(await f.store.load(f.doc.id));
    const link = linkOf(doc, linkId);
    link.sourceAsset = typeof source === "string" ? source : digest(source);
    link.sha256 = link.sourceAsset;
    if (typeof source !== "string") blobs.set(link.sourceAsset, source);
    return doc;
  };
  return { ...f, upload, nets, linkOf, relinked };
}

it("reads pad net names by name from the KiCad 9 and 10 grammars", () => {
  const nets = (name: string) =>
    readBoardNets(parseSexpr(read(name).toString()));
  expect(nets("outline-kicad9.kicad_pcb")).toEqual(fixtureNet);
  expect(nets("outline-kicad10.kicad_pcb")).toEqual(fixtureNet);
  expect(readBoardNets(parseSexpr(reference.toString()))).toEqual(
    referenceNets,
  );
  for (const net of ['(net 0 "")', '(net "")', ""])
    expect(readBoardNets(board(pad(net))), net).toEqual([]);
  for (const net of [
    "(net)",
    "(net 1)",
    '(net x "a")',
    '(net 1 "a" 2)',
    "(net a)",
  ])
    expect(() => readBoardNets(board(pad(net))), net).toThrow(
      "Invalid pad net",
    );
  expect(() => readBoardNets(board(pad('(net "a")'), ""))).toThrow(
    "Footprint with pad nets has no uuid",
  );
});

it("provides equal nets for the KiCad 9 and 10 fixtures without changing the stored snapshot", async () => {
  const f = await fixture();
  const kicad9 = await f.upload(read("outline-kicad9.kicad_pcb"));
  const kicad10 = await f.upload(read("outline-kicad10.kicad_pcb"));
  expect(await f.nets(kicad9)).toEqual({ nets: fixtureNet });
  expect(await f.nets(kicad10)).toEqual(await f.nets(kicad9));
  const linkId = await f.upload(reference);
  expect(await f.nets(linkId)).toEqual({ nets: referenceNets });
  const link = f.linkOf(await f.store.load(f.doc.id), linkId);
  const snapshot = (
    await f.store.blob(f.doc.id, link.snapshotAsset)
  ).toString();
  expect(snapshot).toBe(
    JSON.stringify({
      version: 1,
      data: readBoard(parseSexpr(reference.toString())),
    }),
  );
  expect(snapshot).not.toContain("GND");
});

it("refuses invalid input, unknown or foreign links and missing or invalid sources", async () => {
  const f = await fixture();
  const linkId = await f.upload(reference);
  const other = await f.store.create("Other", f.owner.user.id);
  const foreign = await f.upload(reference, other.id, f.owner);
  const refused = (input: unknown) =>
    expect(f.nets(input)).rejects.toMatchObject({ code: "unprocessable" });
  await refused(1);
  await refused("x".repeat(129));
  await refused("missing");
  await refused("__proto__");
  await refused(foreign);
  await expect(
    f.nets(linkId, f.relinked(linkId, "0".repeat(64))),
  ).rejects.toThrow("KiCad board source is missing");
  await expect(
    f.nets(linkId, f.relinked(linkId, new TextEncoder().encode("(kicad_pcb"))),
  ).rejects.toThrow("KiCad board source is invalid");
});
