import {
  createElement as h,
  Fragment,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Type, type TObject } from "typebox";
import type {
  ClientContext,
  FaceRef,
  OpenProject,
  UserDataEntry,
} from "@rockett/plugin-api";
import { signRoute, type CamData } from "../shared/document.js";
import { machineKind, type MachineProfile } from "../shared/machine.js";
import { toolRefusal, type OperationType } from "../shared/operations.js";
import {
  adaptiveParams,
  contourParams,
  drillParams,
  laserParams,
  paramsOf,
  pocketParams,
} from "../shared/params.js";
import { presetFits, type Preset, type Tool } from "../shared/tools.js";
import { banner, button, libraryOf, reason } from "./libraryParts.js";
import { resuggested, useDefaultMill } from "./presetForm.js";
import { faceKeys, firstChoices, schemaFields } from "./schemaForm.js";
import { camRead, editCam, withOperations } from "./setup.js";
import type { ToolpathPreview } from "./toolpaths.js";

export const MILL_GROUP = "rockett.cam.group.mill";
export const LASER_GROUP = "rockett.cam.group.laser";

export type OperationDialog = {
  type: OperationType;
  label: string;
  schema: TObject;
  toolbar?: { icon: `${string}.svg`; group: string };
};

export const OPERATION_DIALOGS: readonly OperationDialog[] = [
  {
    type: "rockett.cam.contour",
    label: "Contour",
    schema: contourParams,
    toolbar: { icon: "contour.svg", group: MILL_GROUP },
  },
  {
    type: "rockett.cam.pocket",
    label: "Pocket",
    schema: pocketParams,
    toolbar: { icon: "pocket.svg", group: MILL_GROUP },
  },
  { type: "rockett.cam.adaptive", label: "Adaptive", schema: adaptiveParams },
  { type: "rockett.cam.drill", label: "Drill", schema: drillParams },
  {
    type: "rockett.cam.laser",
    label: "Laser",
    schema: laserParams,
    toolbar: { icon: "laser.svg", group: LASER_GROUP },
  },
];

export const dialogPanel = ({ type }: OperationDialog) => `${type}.dialog`;

type Params = Record<string, unknown>;

export type List<T> =
  | { status: "loading" }
  | { status: "ready"; items: T[] }
  | { status: "failed"; reason: string };

type Named = { id: string; name?: string | undefined };

type Texts = { loading: string; empty: string; failed: string };

const withFaces = (schema: TObject, params: Params, face?: FaceRef) =>
  face
    ? {
        ...params,
        ...Object.fromEntries(faceKeys(schema).map((key) => [key, face])),
      }
    : params;

const unset = (schema: TObject, params: Params) =>
  Object.entries(schema.properties)
    .filter(
      ([key, field]) =>
        (field as { title?: string }).title !== undefined &&
        !Type.IsOptional(field) &&
        params[key] === undefined,
    )
    .map(([key]) => key);

export function setupList(open: OpenProject): List<CamData["setups"][number]> {
  const read = camRead(open);
  return read.status === "kept"
    ? { status: "failed", reason: read.reason }
    : { status: "ready", items: read.data.setups };
}

export function copyTool(
  data: CamData,
  tool: Tool,
  { toolId: _link, ...preset }: Preset,
): { tools: CamData["tools"]; toolId: string } {
  const copy = data.tools.find((item) => item.libraryRef?.id === tool.id);
  if (!copy) {
    const toolId = crypto.randomUUID();
    const number = Math.max(0, ...data.tools.map((t) => t.number ?? 0)) + 1;
    const made = {
      ...tool,
      id: toolId,
      libraryRef: { id: tool.id },
      number,
      presets: [preset],
    };
    return { tools: [...data.tools, made], toolId };
  }
  const presets = copy.presets ?? [];
  if (presets.some((item) => item.id === preset.id))
    return { tools: data.tools, toolId: copy.id };
  return {
    tools: data.tools.map((item) =>
      item === copy ? { ...copy, presets: [...presets, preset] } : item,
    ),
    toolId: copy.id,
  };
}

type Draft = {
  setupId: string;
  tool: Tool;
  preset: Preset;
  params: Params;
};

function addOperation(
  data: CamData,
  { type, label }: OperationDialog,
  { setupId, tool, preset, params }: Draft,
): CamData {
  const { tools, toolId } = copyTool(data, tool, preset);
  return withOperations({ ...data, tools }, setupId, (operations) => [
    ...operations,
    {
      id: crypto.randomUUID(),
      type,
      name: `${label} ${operations.filter((op) => op.type === type).length + 1}`,
      toolId,
      presetId: preset.id,
      params,
    },
  ]);
}

export function picker<T extends Named>(
  ui: ClientContext["ui"],
  label: string,
  list: List<T>,
  chosen: T | undefined,
  choose: (id: string) => void,
  texts: Texts,
) {
  if (list.status === "loading")
    return h("span", { key: label, className: "field-hint" }, texts.loading);
  if (list.status === "failed")
    return h(
      Fragment,
      { key: label },
      banner(`${texts.failed}: ${list.reason}.`),
    );
  if (!chosen)
    return h("span", { key: label, className: "field-hint" }, texts.empty);
  return h(ui.SelectField<string>, {
    key: label,
    label,
    value: chosen.id,
    options: list.items.map((item): [string, string] => [
      item.id,
      item.name ?? item.id,
    ]),
    onChange: choose,
  });
}

export function useLibrary<T>(
  request: ClientContext["request"],
  noun: string,
  keep: (item: T) => boolean = () => true,
): List<T> {
  const [list, setList] = useState<List<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    request<UserDataEntry | null>("GET", noun)
      .then(libraryOf<T>)
      .then(
        ({ items }) =>
          live && setList({ status: "ready", items: items.filter(keep) }),
        (e) => live && setList({ status: "failed", reason: reason(e) }),
      );
    return () => {
      live = false;
    };
  }, []);
  return list;
}

const fitting = (presets: List<Preset>, tool?: Tool): List<Preset> =>
  presets.status === "ready" && tool
    ? {
        status: "ready",
        items: presets.items.filter((item) => presetFits(item, tool)),
      }
    : presets;

export const chosen = <T extends Named>(list: List<T>, id: string) =>
  list.status === "ready"
    ? (list.items.find((item) => item.id === id) ?? list.items[0])
    : undefined;

async function saveOperation(
  project: ClientContext["project"],
  op: OperationDialog,
  { params, ...draft }: Draft,
) {
  const out = { ...params };
  for (const key of faceKeys(op.schema)) {
    const { bodyId, faceName } = params[key] as FaceRef;
    out[key] = await project.read(signRoute, { bodyId, faceName });
  }
  const checked = paramsOf(op.schema, op.type, out);
  await editCam(project, (data) =>
    addOperation(data, op, { ...draft, params: checked }),
  );
}

const RESUGGEST = "Re-suggest for this machine";

type Setup = CamData["setups"][number];

type Again = { key: string } & (
  { text: string; preset: Preset } | { error: string }
);

function otherMill(
  setup: Setup | undefined,
  mill: ReturnType<typeof useDefaultMill>,
) {
  const to = setup?.machine;
  if (!to || !("machine" in mill) || machineKind(to) !== "mill") return;
  if (to.libraryRef.id === mill.machine.id) return;
  return { from: mill.machine, to };
}

function again(
  key: string,
  tool: Tool,
  preset: Preset,
  material: string,
  { from, to }: { from: MachineProfile; to: MachineProfile },
): Again {
  try {
    return { key, ...resuggested(tool, preset, material, from, to) };
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return { key, error: `Re-suggest refused: ${reason(e)}.` };
  }
}

function useResuggest(
  context: ClientContext,
  setup: Setup | undefined,
  tool: Tool | undefined,
  preset: Preset | undefined,
) {
  const mill = useDefaultMill(context);
  const [result, setResult] = useState<Again | null>(null);
  const machines = otherMill(setup, mill);
  const id = `${setup?.id}/${tool?.id}/${preset?.id}`;
  const current = result?.key === id ? result : null;
  const material = setup?.material;
  const run = () =>
    tool &&
    preset &&
    material &&
    machines &&
    setResult(again(id, tool, preset, material, machines));
  const hint = !material
    ? "Re-suggest needs a material on the setup."
    : current && "text" in current && current.text;
  return {
    preset: current && "preset" in current ? current.preset : preset,
    row:
      machines &&
      h(
        Fragment,
        { key: "resuggest" },
        banner(current && "error" in current ? current.error : null),
        button(RESUGGEST, RESUGGEST, !tool || !preset || !material, run),
        hint && h("span", { className: "field-hint" }, hint),
      ),
  };
}

export const SETUP_TEXTS: Texts = {
  loading: "Loading setups...",
  empty: "No setups yet. Add one with Setup.",
  failed: "Setups did not load",
};

const listTexts = ({
  label,
}: OperationDialog): Record<"setup" | "tool" | "preset", Texts> => ({
  setup: SETUP_TEXTS,
  tool: {
    loading: "Loading tools...",
    empty: `No tool in your library can cut a ${label.toLowerCase()}.`,
    failed: "Tools did not load",
  },
  preset: {
    loading: "Loading presets...",
    empty: "No presets for this tool. Add one in Settings, CAM, Tools.",
    failed: "Presets did not load",
  },
});

function useSetup(
  project: ClientContext["project"],
  preview: ToolpathPreview,
  id: string,
) {
  const open = useSyncExternalStore(project.subscribe, project.get);
  const { selection } = useSyncExternalStore(preview.subscribe, preview.get);
  const setups = setupList(open);
  return {
    open,
    setups,
    setup: chosen(setups, id || selection?.setupId || ""),
  };
}

const faceHint = (schema: TObject, blank: string[]) =>
  faceKeys(schema).some((key) => blank.includes(key))
    ? "Select a face in the viewport."
    : null;

export function operationDialog(
  context: ClientContext,
  op: OperationDialog,
  preview: ToolpathPreview,
) {
  const { ui, project, request } = context;
  const close = () => ui.closePanel(dialogPanel(op));
  const usable = (tool: Tool) => !toolRefusal(op.type, tool.kind);
  const texts = listTexts(op);
  return function OperationDialog() {
    const selected = useSyncExternalStore(project.subscribe, project.selection);
    const [params, setParams] = useState<Params>(() =>
      withFaces(op.schema, firstChoices(op.schema), project.selection()[0]),
    );
    const tools = useLibrary(request, "tools", usable);
    const presets = useLibrary<Preset>(request, "presets");
    const [ids, setIds] = useState({ setup: "", tool: "", preset: "" });
    const [saving, setSaving] = useState({ pending: false, error: "" });
    useEffect(
      () => setParams((now) => withFaces(op.schema, now, selected[0])),
      [selected],
    );
    const { open, setups, setup } = useSetup(project, preview, ids.setup);
    const tool = chosen(tools, ids.tool);
    const offered = fitting(presets, tool);
    const preset = chosen(offered, ids.preset);
    const blank = unset(op.schema, params);
    const hint = faceHint(op.schema, blank);
    const ready = setup && tool && preset && blank.length === 0;
    const resuggest = useResuggest(context, setup, tool, preset);
    const save = async () => {
      if (!ready) return;
      setSaving({ pending: true, error: "" });
      try {
        await saveOperation(project, op, {
          setupId: setup.id,
          tool,
          preset: resuggest.preset ?? preset,
          params,
        });
        close();
      } catch (e) {
        setSaving({
          pending: false,
          error: `${op.label} did not save: ${reason(e)}.`,
        });
      }
    };
    const choose = (key: keyof typeof ids) => (id: string) =>
      setIds((now) => ({ ...now, [key]: id }));
    const body = h(
      "div",
      { className: "dialog-body" },
      banner(saving.error || null),
      picker(ui, "Setup", setups, setup, choose("setup"), texts.setup),
      picker(ui, "Tool", tools, tool, choose("tool"), texts.tool),
      picker(ui, "Preset", offered, preset, choose("preset"), texts.preset),
      resuggest.row,
      schemaFields(
        ui,
        op.schema,
        params,
        setParams,
        ({ bodyId, faceName }) =>
          `${open.bodies.find((item) => item.id === bodyId)?.name ?? bodyId} ${faceName}`,
      ),
      hint && h("span", { className: "field-hint" }, hint),
    );
    const footer = h(ui.DialogFooter, {
      onOk: () => void save(),
      onCancel: close,
      pending: saving.pending,
      okDisabled: !ready,
    });
    return h(ui.DraggablePanel, {
      title: op.label,
      children: h(Fragment, null, body, footer),
    });
  };
}
