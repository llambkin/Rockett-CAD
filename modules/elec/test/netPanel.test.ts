import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type {
  ClientContext,
  Command,
  Layer,
  MenuItem,
  Panel,
  PickRef,
  ViewportLayer,
} from "@rockett/plugin-api";
import { pathFor, type Feature, type Route } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import { serverModules } from "../../index.server.js";
import client from "../client.js";
import manifest from "../manifest.json";
import server from "../server.js";
import {
  COMPONENT_HINT,
  CONNECTOR_TEXTS,
  NET_LAYER,
  NET_PANEL,
  NET_TEXTS,
  netPanel,
  netPanelBody,
} from "../src/client/netPanel.js";

const provider = serverModules.find(
  (entry) => entry.manifest.id === "rockett.kicad",
)!;
const elec = { manifest, server };
const J1 = "00000000-0000-4000-8000-000000000001";
const R1 = "00000000-0000-4000-8000-000000000003";
const pad = (n: string, at: string, net: string) =>
  `(pad "${n}" thru_hole rect (at ${at}) (size 1.7 1.7) (drill 1) (layers "*.Cu") ${net})`;
const source = `(kicad_pcb (version 20241229) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 40 40) (layer "Edge.Cuts") (width 0.05))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical" (layer "F.Cu")
    (uuid "${J1}") (at 10 20)
    (property "Reference" "J1")
    ${pad("1", "0 0", '(net "+3V3")')}
    ${pad("2", "0 2.54", '(net "SDA")')})
  (footprint "Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical" (layer "B.Cu")
    (uuid "00000000-0000-4000-8000-000000000002") (at 30 10 90)
    (property "Reference" "J2")
    ${pad("1", "0 0", '(net "+3V3")')}
    ${pad("2", "2.5 0", "")})
  (footprint "Resistor_SMD:R_0603_1608Metric" (layer "F.Cu")
    (uuid "${R1}") (at 5 5)
    (property "Reference" "R1")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net "+3V3"))))`;
const POWER = [
  [120, 10, 11.6],
  [110, 30, 10],
  [105, 5, 11.6],
];
const SDA = [[122.54, 10, 11.6]];
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

type Element = {
  type: unknown;
  props: { children?: unknown; role?: string; onClick?: () => void };
};
const isElement = (node: unknown): node is Element =>
  !!node && typeof node === "object" && "props" in node;
const elements = (node: unknown): Element[] =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : isElement(node)
      ? [node, ...elements(node.props.children)]
      : [];
const text = (node: unknown): string =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(text).join("")
      : isElement(node)
        ? text(node.props.children)
        : "";

let close = async () => {};
beforeAll(() => {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: () => "#3399ff",
  }));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(async () => {
  await close();
  close = async () => {};
});

async function project(placed: boolean) {
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
  const response = await f.request(
    `/projects/${f.doc.id}/m/rockett/kicad/upload`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
      },
      body: JSON.stringify({ source: Buffer.from(source).toString("base64") }),
    },
  );
  expect(response.status).toBe(200);
  const { linkId } = (await response.json()) as { linkId: string };
  if (placed) {
    const doc = await f.store.load(f.doc.id);
    doc.features = [boardFeature("board", linkId)];
    doc.timelinePosition = 1;
    await f.store.save(doc, f.owner.user.id);
  }
  const document = await f.store.load(f.doc.id);
  const registered = {
    commands: [] as Command[],
    items: [] as MenuItem[],
    panels: [] as Panel[],
    layers: [] as Layer[],
  };
  const opened: string[] = [];
  const context = {
    register: {
      command: (c: Command) => (registered.commands.push(c), () => {}),
      menuItem: (i: MenuItem) => (registered.items.push(i), () => {}),
      panel: (p: Panel) => (registered.panels.push(p), () => {}),
      layer: (l: Layer) => (registered.layers.push(l), () => {}),
    },
    project: {
      selection: () => [
        { kind: "face", bodyId: "b:board", faceName: "f:board:l:top" },
      ],
      picks: () => [],
      subscribe: () => () => {},
      get: () => ({
        projectId: f.doc.id,
        document,
        bodies: [{ id: "b:board", name: "Board" }],
      }),
      read: async (route: Route, params: Record<string, string>) => {
        const reply = await f.request(
          pathFor(route, { ...params, id: f.doc.id }),
        );
        const body = await reply.json();
        if (!reply.ok) throw new Error(body.error);
        return body;
      },
    },
    ui: {
      TextField: () => null,
      DraggablePanel: ({
        title,
        children,
      }: {
        title: string;
        children: ReactNode;
      }) => h("section", null, title, children),
      DialogFooter: () => null,
      openPanel: (id: string) => opened.push(id),
      closePanel: () => {},
    },
  } as unknown as ClientContext;
  return { linkId, context, registered, opened };
}

function viewport() {
  const group = new THREE.Group();
  const layer = {
    group,
    requestRender: () => {},
    clearGroup: (g: THREE.Object3D) => g.clear(),
  } as unknown as ViewportLayer;
  const lit = () =>
    group.children.flatMap((object) => {
      if (!(object instanceof THREE.Points)) return [];
      expect(object.material.userData.themeToken).toBe("selection");
      const at = object.geometry.getAttribute("position");
      return Array.from({ length: at.count }, (_, i) =>
        [at.getX(i), at.getY(i), at.getZ(i)].map(
          (value) => Math.round(value * 1e4) / 1e4 + 0,
        ),
      );
    });
  return { layer, lit };
}

const sorted = (points: number[][]) =>
  points.toSorted((a, b) => a.join().localeCompare(b.join()));

it("opens the panel on the selected board from its command", async () => {
  const { context, registered, opened } = await project(true);
  await client.activate(context);
  expect(registered.panels.map(({ id }) => id)).toEqual([NET_PANEL]);
  expect(registered.layers.map(({ id }) => id)).toEqual([NET_LAYER]);
  const command = registered.commands.find(
    ({ id }) => id === "rockett.elec.openPanel",
  )!;
  expect(command.enabled?.(undefined)).toBe(true);
  await command.run!(undefined);
  expect(opened).toEqual([NET_PANEL]);
});

it("selecting a net highlights exactly its pads", async () => {
  const real = await project(true);
  const shown = netPanel(real.context);
  const view = viewport();
  const unmount = shown.layer.mount(view.layer);
  const showing = shown.show({
    bodyId: "b:board",
    featureId: "board",
    linkId: real.linkId,
  });
  expect(real.opened).toEqual([NET_PANEL]);
  await showing;
  const body = (search = "", picks: PickRef[] = []) =>
    elements(
      netPanelBody(
        real.context.ui,
        shown.get(),
        picks,
        search,
        () => {},
        shown.pick,
      ),
    );
  const rows = (search?: string) =>
    body(search).filter(({ props }) => props.role === "listitem");
  expect(rows().map(text)).toEqual(["+3V3", "SDA", "J1", "J2"]);
  expect(view.lit()).toEqual([]);

  rows().find((row) => text(row) === "+3V3")!.props.onClick!();
  expect(sorted(view.lit())).toEqual(sorted(POWER));
  expect(view.lit()).not.toContainEqual(SDA[0]);
  expect(view.lit()).not.toContainEqual([107.5, 30, 10]);

  rows().find((row) => text(row) === "SDA")!.props.onClick!();
  expect(view.lit()).toEqual(SDA);
  rows().find((row) => text(row) === "SDA")!.props.onClick!();
  expect(view.lit()).toEqual([]);
  unmount?.();
});

it("searches both lists and shows a selected component's Reference and nets", async () => {
  const { context, linkId } = await project(true);
  const panel = netPanel(context);
  const board = { bodyId: "b:board", featureId: "board", linkId };
  const loading = panel.show(board);
  const all = (search = "", picks: PickRef[] = []) =>
    netPanelBody(context.ui, panel.get(), picks, search, () => {}, panel.pick);
  expect(text(all())).toContain(NET_TEXTS.loading);
  expect(text(all())).toContain(CONNECTOR_TEXTS.loading);
  await loading;
  const listed = (search: string) =>
    elements(all(search))
      .filter(({ props }) => props.role === "listitem")
      .map(text);
  expect(listed("sd")).toEqual(["SDA"]);
  expect(listed("j2")).toEqual(["J2"]);
  expect(text(all("zzz"))).toContain(NET_TEXTS.unmatched);
  expect(text(all("zzz"))).toContain(CONNECTOR_TEXTS.unmatched);
  expect(text(all())).toContain(COMPONENT_HINT);

  const r1 = `rockett.kicad:board:${linkId}:${R1}`;
  const component = all("", [{ kind: "body", bodyId: r1 }]);
  expect(text(component)).toContain("ReferenceR1");
  expect(
    elements(component.at(-1))
      .filter(({ props }) => props.role === "listitem")
      .map(text),
  ).toEqual(["+3V3"]);
  const j1 = all("", [
    {
      kind: "face",
      bodyId: `rockett.kicad:board:${linkId}:${J1}`,
      faceName: "x",
    },
  ]);
  expect(
    elements(j1.at(-1))
      .filter(({ props }) => props.role === "listitem")
      .map(text),
  ).toEqual(["+3V3", "SDA"]);
  expect(
    text(
      all("", [
        { kind: "body", bodyId: `rockett.kicad:other:${linkId}:${R1}` },
      ]),
    ),
  ).toContain(COMPONENT_HINT);
});

it("states the refusal when the board cannot be read", async () => {
  const { context, linkId } = await project(false);
  const panel = netPanel(context);
  await panel.show({ bodyId: "b:board", featureId: "board", linkId });
  const shown = renderToStaticMarkup(h(panel.NetPanel));
  expect(shown).toContain("Electrical");
  expect(shown).toContain(
    `${NET_TEXTS.failed}: KiCad board link is not placed by a board feature.`,
  );
  expect(shown).toContain(
    `${CONNECTOR_TEXTS.failed}: KiCad board link is not placed by a board feature.`,
  );
});
