import {
  createElement as h,
  Fragment,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ClientContext,
  ProjectView,
  UserDataEntry,
} from "@rockett/plugin-api";
import {
  planOperations,
  type Plan,
  type PlannedOperation,
  type PlanTool,
} from "../plan/plan.js";
import { featuresRoute, type CamData } from "../shared/document.js";
import type { MachineProfile } from "../shared/machine.js";
import { defaultMachine } from "../shared/settings.js";
import {
  newPreset,
  presetFits,
  type Preset,
  type Tool,
} from "../shared/tools.js";
import { banner, libraryOf, reason, row, tree } from "./libraryParts.js";
import { copyTool } from "./opDialog.js";
import { suggested } from "./presetForm.js";
import { camRead, editCam, withOperations } from "./setup.js";
import type { ToolpathPreview } from "./toolpaths.js";

export const PLAN_PANEL = "rockett.cam.plan.dialog";

type Setup = CamData["setups"][number];

export type Planning = {
  setupId: string;
  material?: string | undefined;
  machine: MachineProfile;
  tools: PlanTool[];
};

type Planned = { key: string } & (
  | { plan: Plan; planning: Planning; unchecked: ReadonlySet<string> }
  | { error: string }
);

function presetOf(
  planning: Planning,
  tool: PlanTool,
  { feeds }: PlannedOperation,
  made: Map<string, Preset>,
): Preset {
  if ("presetId" in feeds)
    return tool.presets.find(({ id }) => id === feeds.presetId)!;
  const kept = made.get(tool.id);
  if (kept) return kept;
  if (!planning.material) throw new Error("the setup names no material");
  const preset = {
    ...newPreset(tool.presets.length),
    ...suggested(tool, planning.material, planning.machine).values,
  };
  made.set(tool.id, preset);
  return preset;
}

export function accepted(
  data: CamData,
  planning: Planning,
  operations: readonly PlannedOperation[],
): CamData {
  const ids = new Map<string, string>();
  const made = new Map<string, Preset>();
  let next = data;
  for (const op of operations) {
    const tool = planning.tools.find(({ id }) => id === op.toolId)!;
    const preset = presetOf(planning, tool, op, made);
    const { tools, toolId } = copyTool(next, tool, preset);
    const id = crypto.randomUUID();
    ids.set(op.id, id);
    const prior = op.prior && ids.get(op.prior);
    next = withOperations({ ...next, tools }, planning.setupId, (all) => [
      ...all,
      {
        id,
        type: op.type,
        name: op.name,
        toolId,
        presetId: preset.id,
        params: op.params,
        ...(prior && { prior }),
      },
    ]);
  }
  return next;
}

export const acceptPlan = (
  view: ProjectView,
  planning: Planning,
  operations: readonly PlannedOperation[],
) => editCam(view, (data) => accepted(data, planning, operations));

const library = <T>(request: ClientContext["request"], noun: string) =>
  request<UserDataEntry | null>("GET", noun).then(libraryOf<T>);

async function planFor(
  { project, request, settings }: ClientContext,
  setup: Setup,
): Promise<{ plan: Plan; planning: Planning }> {
  const [features, tools, presets, machines] = await Promise.all([
    project.read(featuresRoute, { setupId: setup.id }),
    library<Tool>(request, "tools"),
    library<Preset>(request, "presets"),
    setup.machine ? null : library<MachineProfile>(request, "machines"),
  ]);
  if ("reason" in features) throw new Error(features.reason);
  const machine =
    setup.machine ?? defaultMachine(settings, machines?.items ?? []);
  if (!machine) throw new Error("no machine in your library");
  const { clearance } = setup;
  if (clearance === undefined)
    throw new Error(`setup ${setup.name ?? setup.id} needs a clearance`);
  const planning = {
    setupId: setup.id,
    material: setup.material,
    machine,
    tools: tools.items.map((tool) => ({
      ...tool,
      presets: presets.items.filter((preset) => presetFits(preset, tool)),
    })),
  };
  return {
    planning,
    plan: planOperations(
      { ...setup, clearance, fixtures: setup.fixtures ?? [] },
      features,
      planning.tools,
      planning.machine,
    ),
  };
}

const hint = (text: string) => h("span", { className: "field-hint" }, text);

const setupOf = (view: ProjectView, setupId: string | undefined) => {
  const read = camRead(view.get());
  return read.status === "ready"
    ? read.data.setups.find(({ id }) => id === setupId)
    : undefined;
};

type Ready = Extract<Planned, { plan: Plan }>;

function usePlanned(context: ClientContext, preview: ToolpathPreview) {
  const { project } = context;
  const open = useSyncExternalStore(project.subscribe, project.get);
  const { selection } = useSyncExternalStore(preview.subscribe, preview.get);
  const format = context.ui.useFormatLength();
  const [planned, setPlanned] = useState<Planned | null>(null);
  const setup = setupOf(project, selection?.setupId);
  const key = `${open.projectId}/${setup?.id}`;
  useEffect(() => {
    const chosen = setupOf(project, selection?.setupId);
    if (!chosen) return;
    let live = true;
    planFor(context, chosen).then(
      (made) => live && setPlanned({ key, ...made, unchecked: new Set() }),
      (e: unknown) => live && setPlanned({ key, error: reason(e) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  const current = planned?.key === key ? planned : null;
  const ready = current && "plan" in current ? current : null;
  const checked =
    ready?.plan.operations.filter(({ id }) => !ready.unchecked.has(id)) ?? [];
  const read = camRead(open);
  const after =
    ready && read.status === "ready"
      ? accepted(read.data, ready.planning, checked)
      : null;
  const toggle = (id: string) => (on: boolean) =>
    ready &&
    setPlanned({
      ...ready,
      unchecked: new Set(
        on
          ? [...ready.unchecked].filter((item) => item !== id)
          : [...ready.unchecked, id],
      ),
    });
  return { setup, current, ready, checked, after, toggle, format };
}

type View = ReturnType<typeof usePlanned>;

function planList(ui: ClientContext["ui"], ready: Ready, view: View) {
  const toolText = ({ toolId }: PlannedOperation) => {
    const tool = ready.planning.tools.find(({ id }) => id === toolId);
    const copy = view.after?.tools.find(
      (item) => item.libraryRef?.id === toolId,
    );
    const text = tool ? `${view.format(tool.diameter)} ${tool.kind}` : toolId;
    return copy?.number ? `T${copy.number} ${text}` : text;
  };
  const { operations, unplanned } = ready.plan;
  if (!operations.length && !unplanned.length)
    return hint("Nothing to plan in this setup.");
  return h(
    Fragment,
    null,
    operations.length > 0 &&
      tree(
        { title: "Proposed, in order" },
        operations.map((op, index) =>
          h(
            "div",
            { key: op.id, className: "tree-item", role: "listitem" },
            h(ui.CheckField, {
              label: `${index + 1} ${op.name}`,
              value: !ready.unchecked.has(op.id),
              onChange: view.toggle(op.id),
            }),
            h("span", null, toolText(op)),
          ),
        ),
      ),
    unplanned.length > 0 &&
      tree(
        { title: "Not planned" },
        unplanned.map(({ feature, reason: why }, index) =>
          row(
            { key: String(index), name: "!" },
            h("span", null, `${feature}: ${why}`),
          ),
        ),
      ),
  );
}

function planBody(ui: ClientContext["ui"], view: View) {
  const { setup, current, ready } = view;
  if (!setup)
    return banner(
      "Planning failed: select a setup in the Manufacture browser.",
    );
  if (!current) return hint("Planning...");
  if (!ready)
    return "error" in current && banner(`Planning failed: ${current.error}.`);
  return planList(ui, ready, view);
}

export function planDialog(context: ClientContext, preview: ToolpathPreview) {
  const { ui, project } = context;
  const close = () => ui.closePanel(PLAN_PANEL);
  return function PlanDialog() {
    const view = usePlanned(context, preview);
    const [saving, setSaving] = useState({ pending: false, error: "" });
    const { setup, ready, checked } = view;
    const save = async () => {
      if (!ready || !checked.length) return;
      setSaving({ pending: true, error: "" });
      try {
        await acceptPlan(project, ready.planning, checked);
        close();
      } catch (e) {
        setSaving({
          pending: false,
          error: `Plan operations did not save: ${reason(e)}.`,
        });
      }
    };
    const count = checked.length;
    return h(ui.DraggablePanel, {
      title: setup
        ? `Plan operations: ${setup.name ?? setup.id}`
        : "Plan operations",
      children: h(
        Fragment,
        null,
        h(
          "div",
          { className: "dialog-body" },
          banner(saving.error || null),
          planBody(ui, view),
        ),
        h(ui.DialogFooter, {
          onOk: () => void save(),
          onCancel: close,
          pending: saving.pending,
          okLabel: `Add ${count} operation${count === 1 ? "" : "s"}`,
          okDisabled: !count,
        }),
      ),
    });
  };
}

export function registerPlan(context: ClientContext, preview: ToolpathPreview) {
  const { register, ui } = context;
  register.command({
    id: "rockett.cam.plan",
    label: "Plan operations",
    run: () => ui.openPanel(PLAN_PANEL),
  });
  register.panel({
    id: PLAN_PANEL,
    title: "Plan operations",
    when: (_state, open) => open.includes(PLAN_PANEL),
    component: planDialog(context, preview),
  });
}
