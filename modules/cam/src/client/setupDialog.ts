import { createElement as h, Fragment, useEffect, useState } from "react";
import type {
  ClientContext,
  NumberFieldProps,
  OpenProject,
} from "@rockett/plugin-api";
import { MATERIAL_OPTIONS } from "../feeds/suggest.js";
import type { Post } from "../post/schema.js";
import type { Xyz } from "../shared/ir.js";
import type { MachineProfile } from "../shared/machine.js";
import { MIN_TOLERANCE } from "../shared/params.js";
import { defaultMachine, setupDefaults } from "../shared/settings.js";
import type { Stock } from "../shared/setup.js";
import {
  fixturesOf,
  holdDownRows,
  type HoldDown,
  type HoldDownDraft,
} from "./holdDowns.js";
import { lostPost, MACHINE_TEXTS, postChoices } from "./ncDialog.js";
import { chosen, picker, useLibrary } from "./opDialog.js";
import {
  defaultBodies,
  newSetup,
  saveSetup,
  withStockKind,
  type DialogSetup,
} from "./setup.js";

export const SETUP_PANEL = "rockett.cam.setup.dialog";

type Margin = keyof Extract<Stock, { kind: "boxAround" }>["margins"];
type Corner = Extract<DialogSetup["wcs"]["origin"], { kind: "stockCorner" }>;

const ALL_BODIES = "";

const NO_MATERIAL = "";

const MATERIALS: [string, string][] = [
  [NO_MATERIAL, "None"],
  ...MATERIAL_OPTIONS,
];

const STOCK_KINDS: [Stock["kind"], string][] = [
  ["boxAround", "Box around bodies"],
  ["box", "Box"],
  ["cylinder", "Cylinder"],
];

const MARGINS: [Margin, string][] = [
  ["xMax", "+X"],
  ["xMin", "-X"],
  ["yMax", "+Y"],
  ["yMin", "-Y"],
  ["zMin", "-Z"],
  ["zMax", "+Z"],
];

const SIZES = ["Length", "Width", "Height"] as const;

const SIDES = ["min", "max"] as const;

const CORNERS: Corner[] = (["max", "min"] as const).flatMap((z) =>
  SIDES.flatMap((y) =>
    SIDES.map((x): Corner => ({ kind: "stockCorner", x, y, z })),
  ),
);

const cornerKey = ({ x, y, z }: Corner) => `${x} ${y} ${z}`;

const cornerLabel = ({ x, y, z }: Corner) =>
  `Stock corner, ${y === "min" ? "front" : "back"} ${x === "min" ? "left" : "right"}, ${z === "max" ? "top" : "bottom"}`;

const CORNER_OPTIONS = CORNERS.map((c): [string, string] => [
  cornerKey(c),
  cornerLabel(c),
]);

const OFFSETS = [54, 55, 56, 57, 58, 59].map((g, i): [string, string] => [
  String(i + 1),
  `G${g}`,
]);

const resized = (size: Xyz, i: number, value: number): Xyz => [
  i === 0 ? value : size[0],
  i === 1 ? value : size[1],
  i === 2 ? value : size[2],
];

function stockSizes(
  ui: ClientContext["ui"],
  stock: Stock,
  setStock: (stock: Stock) => void,
) {
  const length = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    bound: Pick<NumberFieldProps, "min" | "above">,
  ) => h(ui.LengthField, { key: label, label, value, onChange, ...bound });
  if (stock.kind === "boxAround")
    return MARGINS.map(([side, label]) =>
      length(
        label,
        stock.margins[side],
        (v) => setStock({ ...stock, margins: { ...stock.margins, [side]: v } }),
        { min: 0 },
      ),
    );
  if (stock.kind === "box")
    return SIZES.map((label, i) =>
      length(
        label,
        stock.size[i]!,
        (v) => setStock({ ...stock, size: resized(stock.size, i, v) }),
        { above: 0 },
      ),
    );
  return [
    length(
      "Diameter",
      stock.diameter,
      (diameter) => setStock({ ...stock, diameter }),
      { above: 0 },
    ),
    length("Height", stock.height, (height) => setStock({ ...stock, height }), {
      above: 0,
    }),
  ];
}

type Picks = { machineId?: string; postId?: string };

type Edit = (patch: Partial<DialogSetup>) => void;

function useTarget({
  ui,
  request,
  settings,
}: Pick<ClientContext, "ui" | "request" | "settings">) {
  const [picks, setPicks] = useState<Picks>({});
  const machines = useLibrary<MachineProfile>(request, "machines");
  const posts = useLibrary<Post>(request, "posts");
  const fallback =
    machines.status === "ready"
      ? defaultMachine(settings, machines.items)?.id
      : "";
  const machine = chosen(machines, picks.machineId || fallback || "");
  const own = posts.status === "ready" ? posts.items : [];
  const postId = picks.postId ?? machine?.post ?? "";
  const { options, post, library } = postChoices(own, [], postId);
  const rows = h(
    Fragment,
    null,
    picker(
      ui,
      "Machine",
      machines,
      machine,
      (id) => setPicks({ machineId: id }),
      MACHINE_TEXTS,
    ),
    machine &&
      h(ui.SelectField<string>, {
        label: "Post",
        value: postId,
        options,
        onChange: (id) => setPicks((now) => ({ ...now, postId: id })),
      }),
    lostPost(machine, !post && posts.status === "ready"),
  );
  const stored = (setup: DialogSetup): DialogSetup =>
    machine
      ? {
          ...setup,
          machine: { ...machine, libraryRef: { id: machine.id } },
          ...(post && { postId: post.id }),
          ...(library && {
            post: { ...library, libraryRef: { id: library.id } },
          }),
        }
      : setup;
  const loading = machines.status === "loading" || posts.status === "loading";
  return { rows, stored, loading, lost: Boolean(machine && !post) };
}

function placementRows(
  ui: ClientContext["ui"],
  setup: DialogSetup,
  open: OpenProject,
  edit: Edit,
) {
  const { stock, wcs } = setup;
  const setStock = (next: Stock) => edit({ stock: next });
  return h(
    Fragment,
    null,
    h(ui.SelectField<Stock["kind"]>, {
      label: "Stock",
      value: stock.kind,
      options: STOCK_KINDS,
      onChange: (kind) => setStock(withStockKind(setup, kind, open)),
    }),
    stockSizes(ui, stock, setStock),
    wcs.origin.kind === "stockCorner" &&
      h(ui.SelectField<string>, {
        label: "WCS",
        value: cornerKey(wcs.origin),
        options: CORNER_OPTIONS,
        onChange: (key) => {
          const origin = CORNERS.find((c) => cornerKey(c) === key);
          if (origin) edit({ wcs: { ...wcs, origin } });
        },
      }),
    h(ui.SelectField<string>, {
      label: "Offset",
      value: String(wcs.offsetIndex),
      options: OFFSETS,
      onChange: (index) =>
        edit({ wcs: { ...wcs, offsetIndex: Number(index) } }),
    }),
  );
}

const heightRows = (ui: ClientContext["ui"], setup: DialogSetup, edit: Edit) =>
  h(
    Fragment,
    null,
    h(ui.LengthField, {
      label: "Safe height",
      value: setup.safeHeight,
      onChange: (safeHeight) => edit({ safeHeight }),
    }),
    h(ui.LengthField, {
      label: "Clearance",
      value: setup.clearance,
      onChange: (clearance) => edit({ clearance }),
    }),
    h(ui.LengthField, {
      label: "Tolerance",
      value: setup.tolerance,
      min: MIN_TOLERANCE,
      onChange: (tolerance) => edit({ tolerance }),
    }),
    h(
      "span",
      { className: "field-hint" },
      "Default tolerance for new operations in this setup.",
    ),
  );

export function setupDialog(context: ClientContext, draft: HoldDownDraft) {
  const { ui, project, settings } = context;
  return function SetupDialog() {
    const [setup, setSetup] = useState(() =>
      newSetup(project.get(), setupDefaults(settings)),
    );
    const [holdDowns, setHoldDowns] = useState<HoldDown[]>([]);
    const [pending, setPending] = useState(false);
    const fixtures = fixturesOf(holdDowns);
    useEffect(
      () => draft.set({ setup, fixtures: fixturesOf(holdDowns) }),
      [setup, holdDowns],
    );
    useEffect(() => () => draft.set(null), []);
    const target = useTarget(context);
    const open = project.get();
    const edit: Edit = (patch) => setSetup((now) => ({ ...now, ...patch }));
    const close = () => ui.closePanel(SETUP_PANEL);
    const save = () => {
      setPending(true);
      const held = fixtures.length ? { ...setup, fixtures } : setup;
      void saveSetup(project, target.stored(held)).then(close, () =>
        setPending(false),
      );
    };
    const bodyOptions = open.bodies.map(({ id, name }): [string, string] => [
      id,
      name,
    ]);
    if (bodyOptions.length > 1) bodyOptions.unshift([ALL_BODIES, "All bodies"]);
    const body = h(
      "div",
      { className: "dialog-body" },
      h(ui.TextField, {
        label: "Name",
        value: setup.name,
        onChange: (name) => edit({ name }),
      }),
      h(ui.SelectField<string>, {
        label: "Bodies",
        value: setup.bodies.length === 1 ? setup.bodies[0]! : ALL_BODIES,
        options: bodyOptions,
        onChange: (id) =>
          edit({
            bodies: id === ALL_BODIES ? defaultBodies(open) : [id],
          }),
      }),
      h(ui.SelectField<string>, {
        label: "Material",
        value: setup.material ?? NO_MATERIAL,
        options: MATERIALS,
        onChange: (id) =>
          setSetup(({ material: _old, ...now }) =>
            id === NO_MATERIAL ? now : { ...now, material: id },
          ),
      }),
      target.rows,
      placementRows(ui, setup, open, edit),
      heightRows(ui, setup, edit),
      holdDownRows(ui, holdDowns, setHoldDowns),
    );
    const footer = h(ui.DialogFooter, {
      onOk: save,
      onCancel: close,
      pending,
      okDisabled:
        setup.bodies.length === 0 ||
        !setup.name.trim() ||
        target.loading ||
        target.lost,
    });
    return h(ui.DraggablePanel, {
      title: setup.name,
      children: h(Fragment, null, body, footer),
    });
  };
}
