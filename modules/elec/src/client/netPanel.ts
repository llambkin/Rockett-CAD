import {
  createElement as h,
  Fragment,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import * as THREE from "three";
import {
  moduleBodyId,
  themed,
  type ClientContext,
  type Dispose,
  type Layer,
  type PickRef,
  type ProjectView,
} from "@rockett/plugin-api";
import { PROVIDER } from "../boardNets.js";
import { padsRoute, type BoardPads } from "../server/boardPads.js";

export const NET_PANEL = "rockett.elec.panel";
export const NET_LAYER = "rockett.elec.nets";

const PAD_TOKEN = "selection";
const PAD_SIZE_PX = 10;

export const NET_TEXTS = {
  loading: "Loading nets...",
  empty: "No nets on this board.",
  unmatched: "No nets match the search.",
  failed: "Nets did not load",
};

export const CONNECTOR_TEXTS = {
  loading: "Loading connectors...",
  empty: "No connectors on this board.",
  unmatched: "No connectors match the search.",
  failed: "Connectors did not load",
};

export const COMPONENT_HINT =
  "Select a component body to see its Reference and nets.";

type Board = { bodyId: string; featureId: string; linkId: string };

type Loaded =
  | { status: "loading" }
  | { status: "failed"; reason: string }
  | { status: "ready"; pads: BoardPads };

type NetState = {
  board: Board | null;
  loaded: Loaded;
  net: string | null;
};

type Texts = typeof NET_TEXTS;
type Footprint = BoardPads["footprints"][number];

export function selectedBoard(project: ProjectView): Board | undefined {
  const picked = project.selection();
  if (picked.length !== 1) return undefined;
  const { bodyId } = picked[0]!;
  const feature = project
    .get()
    .document?.features.find(
      ({ id, type }) => type === `${PROVIDER}.board` && `b:${id}` === bodyId,
    );
  const linkId =
    feature && "params" in feature ? feature.params.linkId : undefined;
  return feature && typeof linkId === "string"
    ? { bodyId, featureId: feature.id, linkId }
    : undefined;
}

export const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const componentBody = (board: Board, footprintUuid: string) =>
  moduleBodyId(PROVIDER, board.featureId, `${board.linkId}:${footprintUuid}`);

function pickedFootprint(
  { board, loaded }: NetState,
  picks: readonly PickRef[],
): Footprint | undefined {
  if (!board || loaded.status !== "ready") return undefined;
  const picked = new Set(picks.map(({ bodyId }) => bodyId));
  return loaded.pads.footprints.find(({ footprintUuid }) =>
    picked.has(componentBody(board, footprintUuid)),
  );
}

function highlightedPads({ loaded, net }: NetState) {
  if (loaded.status !== "ready" || net === null) return [];
  return loaded.pads.footprints.flatMap(({ pins }) =>
    pins.filter((pin) => pin.net === net).map(({ position }) => position),
  );
}

function padPoints(positions: [number, number, number][]) {
  const points = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(
      positions.map((at) => new THREE.Vector3(...at)),
    ),
    themed(
      new THREE.PointsMaterial({
        size: PAD_SIZE_PX,
        sizeAttenuation: false,
        depthTest: false,
      }),
      PAD_TOKEN,
    ),
  );
  points.renderOrder = 11;
  return points;
}

const matches = (name: string, search: string) =>
  name.toLowerCase().includes(search.trim().toLowerCase());

const row = (
  key: string,
  name: string,
  selected: boolean,
  onClick?: () => void,
) =>
  h(
    "div",
    {
      key,
      className: selected ? "tree-item selected" : "tree-item",
      role: "listitem",
      onClick,
    },
    h("span", null, name),
  );

const section = (title: string, ...children: ReactNode[]) =>
  h(
    "div",
    { key: title, className: "tree-section" },
    h("div", { className: "tree-header" }, title),
    h(
      "div",
      { className: "tree-children", role: "list", "aria-label": title },
      ...children,
    ),
  );

const empty = (text: string) =>
  h("div", { key: "empty", className: "tree-empty" }, text);

function list<T>(
  title: string,
  texts: Texts,
  loaded: Loaded,
  items: (pads: BoardPads) => T[],
  name: (item: T) => string,
  render: (item: T) => ReactNode,
  search: string,
) {
  if (loaded.status === "loading") return section(title, empty(texts.loading));
  if (loaded.status === "failed")
    return section(
      title,
      h(
        "div",
        { key: "failed", className: "error-banner", role: "alert" },
        `${texts.failed}: ${loaded.reason}.`,
      ),
    );
  const all = items(loaded.pads);
  const shown = all.filter((item) => matches(name(item), search));
  if (!all.length) return section(title, empty(texts.empty));
  if (!shown.length) return section(title, empty(texts.unmatched));
  return section(title, ...shown.map(render));
}

function netsOf({ pins }: Footprint, order: readonly string[]) {
  const own = new Set(
    pins.flatMap(({ net }) => (net === undefined ? [] : [net])),
  );
  return order.filter((net) => own.has(net));
}

export function netPanelBody(
  ui: ClientContext["ui"],
  state: NetState,
  picks: readonly PickRef[],
  search: string,
  setSearch: (search: string) => void,
  pick: (net: string | null) => void,
) {
  const toggle = (net: string) => () => pick(state.net === net ? null : net);
  const netRow = (net: string) => row(net, net, state.net === net, toggle(net));
  const footprint = pickedFootprint(state, picks);
  const order = state.loaded.status === "ready" ? state.loaded.pads.nets : [];
  const own = footprint && netsOf(footprint, order);
  return [
    h(ui.TextField, {
      key: "search",
      label: "Search",
      value: search,
      onChange: setSearch,
    }),
    list(
      "Nets",
      NET_TEXTS,
      state.loaded,
      ({ nets }) => nets,
      (net) => net,
      netRow,
      search,
    ),
    list(
      "Connectors",
      CONNECTOR_TEXTS,
      state.loaded,
      ({ footprints }) => footprints.filter(({ connector }) => connector),
      ({ reference }) => reference,
      ({ footprintUuid, reference }) => row(footprintUuid, reference, false),
      search,
    ),
    section(
      "Component",
      ...(footprint && own
        ? [
            h(
              "div",
              { key: "reference", className: "sel-info have" },
              h("span", null, "Reference"),
              h("b", null, footprint.reference),
            ),
            ...(own.length
              ? own.map(netRow)
              : [empty(`No nets on ${footprint.reference}.`)]),
          ]
        : [empty(COMPONENT_HINT)]),
    ),
  ];
}

function netStore({ project, ui }: ClientContext) {
  let state: NetState = {
    board: null,
    loaded: { status: "loading" },
    net: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<NetState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  let unwatch: Dispose | null = null;

  async function load(board: Board) {
    try {
      const pads = await project.read(padsRoute, { linkId: board.linkId });
      if (state.board === board) set({ loaded: { status: "ready", pads } });
    } catch (error) {
      if (state.board === board)
        set({ loaded: { status: "failed", reason: reason(error) } });
    }
  }

  function close() {
    unwatch?.();
    unwatch = null;
    set({ board: null, loaded: { status: "loading" }, net: null });
    ui.closePanel(NET_PANEL);
  }

  function watch() {
    if (unwatch) return;
    let seen = project.get();
    unwatch = project.subscribe(() => {
      const now = project.get();
      if (now.document === seen.document) return;
      const moved = now.projectId !== seen.projectId;
      seen = now;
      if (moved) close();
      else if (state.board) void load(state.board);
    });
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    pick: (net: string | null) => set({ net }),
    close,
    async show(board: Board) {
      set({ board, loaded: { status: "loading" }, net: null });
      ui.openPanel(NET_PANEL);
      watch();
      await load(board);
    },
  };
}

type NetStore = ReturnType<typeof netStore>;

const netLayer = ({ get, subscribe }: NetStore): Layer => ({
  id: NET_LAYER,
  mount(view) {
    const draw = () => {
      view.clearGroup(view.group);
      const positions = highlightedPads(get());
      if (positions.length) view.group.add(padPoints(positions));
      view.requestRender();
    };
    draw();
    return subscribe(draw);
  },
});

const netPanelView = (
  { project, ui }: ClientContext,
  { get, subscribe, pick, close }: NetStore,
) =>
  function NetPanel() {
    const now = useSyncExternalStore(subscribe, get, get);
    const picks = useSyncExternalStore(
      project.subscribe,
      project.picks,
      project.picks,
    );
    const [search, setSearch] = useState("");
    return h(ui.DraggablePanel, {
      id: NET_PANEL,
      title: "Electrical",
      children: h(
        Fragment,
        null,
        h(
          "div",
          { className: "dialog-body" },
          ...netPanelBody(ui, now, picks, search, setSearch, pick),
        ),
        h(ui.DialogFooter, { onCancel: close, cancelLabel: "Close" }),
      ),
    });
  };

export function netPanel(context: ClientContext) {
  const store = netStore(context);
  return {
    ...store,
    layer: netLayer(store),
    NetPanel: netPanelView(context, store),
  };
}
