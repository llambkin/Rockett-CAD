import { afterEach, expect, it } from "vitest";
import type {
  ClientContext,
  Command,
  FaceRef,
  MenuItem,
} from "@rockett/plugin-api";
import { pathFor, type Feature, type Route } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import { serverModules } from "../../index.server.js";
import client from "../client.js";
import manifest from "../manifest.json";
import server from "../server.js";

const provider = serverModules.find(
  (entry) => entry.manifest.id === "rockett.kicad",
)!;
const elec = { manifest, server };
const pad = (n: string, at: string, net: string) =>
  `(pad "${n}" thru_hole rect (at ${at}) (size 1.7 1.7) (drill 1) (layers "*.Cu") ${net})`;
const source = `(kicad_pcb (version 20241229) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 40 40) (layer "Edge.Cuts") (width 0.05))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical" (layer "F.Cu")
    (uuid "00000000-0000-4000-8000-000000000001") (at 10 20)
    (property "Reference" "J1,\\"A\\"")
    ${pad("1", "0 0", '(net "+3V3")')}
    ${pad("2", "0 2.54", '(net "SDA,\\"bus\\"")')})
  (footprint "Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical" (layer "B.Cu")
    (uuid "00000000-0000-4000-8000-000000000002") (at 30 10 90)
    (property "Reference" "J2")
    ${pad("1", "0 0", '(net "+3V3")')}
    ${pad("2", "2.5 0", "")})
  (footprint "Resistor_SMD:R_0603_1608Metric" (layer "F.Cu")
    (uuid "00000000-0000-4000-8000-000000000003") (at 5 5)
    (property "Reference" "R1")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net "+3V3"))))`;
const table = [
  "Reference,Pin,Net,X,Y,Z",
  '"J1,""A""",1,+3V3,120,10,11.6',
  '"J1,""A""",2,"SDA,""bus""",122.54,10,11.6',
  "J2,1,+3V3,110,30,10",
  "J2,2,,107.5,30,10",
  "",
].join("\r\n");
const placement = {
  rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  translation: [100, 0, 10],
};
const boardFeature = (id: string, linkId: string): Feature => ({
  id,
  name: id,
  suppressed: false,
  type: "rockett.kicad.board",
  version: 1,
  params: { linkId, placement, options: {} },
});

let close = async () => {};
afterEach(async () => {
  await close();
  close = async () => {};
});

async function project() {
  const f = await moduleProjectFixture({ id: "fixture.empty", mount() {} });
  f.off();
  const stop = await loadModules(
    [provider, elec],
    f.kernel,
    f.store,
    f.folders,
  );
  f.remount();
  close = async () => {
    stop();
    await f.close();
  };
  const upload = async () => {
    const response = await f.request(
      `/projects/${f.doc.id}/m/rockett/kicad/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
        },
        body: JSON.stringify({
          source: Buffer.from(source).toString("base64"),
        }),
      },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { linkId: string }).linkId;
  };
  const place = async (...features: Feature[]) => {
    const doc = await f.store.load(f.doc.id);
    doc.features = features;
    doc.timelinePosition = features.length;
    await f.store.save(doc, f.owner.user.id);
  };
  const pins = (linkId: string) =>
    f.request(`/projects/${f.doc.id}/m/rockett/elec/boards/${linkId}/pins`);
  return { ...f, upload, place, pins };
}

const refusal = async (response: Response) => {
  expect(response.status).toBe(422);
  return ((await response.json()) as { error: string }).error;
};

it("lists one CSV row per connector pin with its net, quoting commas and quotes", async () => {
  const f = await project();
  const linkId = await f.upload();
  await f.place(boardFeature("board", linkId));
  const response = await f.pins(linkId);
  expect(response.status).toBe(200);
  expect(await response.json()).toBe(table);
});

it("refuses an unknown link and a link placed by no board feature or by two", async () => {
  const f = await project();
  const linkId = await f.upload();
  expect(await refusal(await f.pins("missing"))).toBe(
    "KiCad board link is not in this project",
  );
  expect(await refusal(await f.pins(linkId))).toBe(
    "KiCad board link is not placed by a board feature",
  );
  await f.place(boardFeature("a", linkId), boardFeature("b", linkId));
  expect(await refusal(await f.pins(linkId))).toBe(
    "KiCad board link is placed by more than one board feature",
  );
});

it("downloads the selected board's pin table from the face menu", async () => {
  const f = await project();
  const linkId = await f.upload();
  await f.place(boardFeature("board", linkId));
  const document = await f.store.load(f.doc.id);
  const commands: Command[] = [];
  const items: MenuItem[] = [];
  const files: { fileName: string; data: BlobPart; type: string }[] = [];
  let selection: FaceRef[] = [];
  void client.activate({
    register: {
      command: (c: Command) => (commands.push(c), () => {}),
      menuItem: (item: MenuItem) => (items.push(item), () => {}),
      panel: () => () => {},
      layer: () => () => {},
    },
    project: {
      selection: () => selection,
      get: () => ({
        projectId: f.doc.id,
        document,
        bodies: [{ id: "b:board", name: "Board" }],
      }),
      read: async (route: Route, params: Record<string, string>) =>
        (await f.request(pathFor(route, { ...params, id: f.doc.id }))).json(),
    },
    ui: {
      download: (file: (typeof files)[number]) => files.push(file),
      showError: (message: string) => {
        throw new Error(message);
      },
    },
  } as unknown as ClientContext);
  expect(items).toEqual([
    {
      id: "rockett.elec.exportPins",
      menu: "design.viewport.face",
      after: "rockett.kicad.exportOutline",
      command: "rockett.elec.exportPins",
    },
    {
      id: "rockett.elec.openPanel",
      menu: "design.viewport.face",
      after: "rockett.elec.exportPins",
      command: "rockett.elec.openPanel",
    },
  ]);
  const [command] = commands;
  expect(command!.enabled?.(undefined)).toBe(
    "Select a face of one KiCad board",
  );
  selection = [{ kind: "face", bodyId: "b:other", faceName: "f:other:l:top" }];
  expect(command!.enabled?.(undefined)).toBe(
    "Select a face of one KiCad board",
  );
  selection = [{ kind: "face", bodyId: "b:board", faceName: "f:board:l:top" }];
  expect(command!.enabled?.(undefined)).toBe(true);
  await command!.run!(undefined);
  expect(files).toEqual([
    { fileName: "Board pins.csv", data: table, type: "text/csv" },
  ]);
});
