import { createElement as h, Fragment, useState, type ReactNode } from "react";
import type { ClientContext, ClientUi } from "@rockett/plugin-api";
import { MATERIAL_OPTIONS, suggestFeeds } from "../feeds/suggest.js";
import {
  machineKind,
  spindleRange,
  type MachineProfile,
} from "../shared/machine.js";
import { DEFAULT_MACHINE, defaultMachine } from "../shared/settings.js";
import {
  newPreset,
  validatePreset,
  type Coolant,
  type Preset,
  type Tool,
} from "../shared/tools.js";
import {
  banner,
  button,
  placeholder,
  reason,
  row,
  tree,
  useModuleSetting,
  useStored,
} from "./libraryParts.js";
import type { Section, State } from "./toolPanel.js";

type Edit = (preset: Preset) => void;
type Mill = { machine: MachineProfile } | { note: string } | { error: string };

const COOLANTS: [Coolant, string][] = [
  ["off", "Off"],
  ["flood", "Flood"],
  ["mist", "Mist"],
];

const FEEDS = [
  ["cutFeed", "Cut feed (mm/min)"],
  ["plungeFeed", "Plunge feed (mm/min)"],
  ["rampFeed", "Ramp feed (mm/min)"],
] as const;

const UNCHECKED = "so Suggest is off and rpm is not checked";

const FIRST_MATERIAL = MATERIAL_OPTIONS[0]![0];

export function useDefaultMill({ request, settings }: ClientContext): Mill {
  const machines = useStored<MachineProfile>(request, "machines", "Machines");
  useModuleSetting(settings, DEFAULT_MACHINE.key);
  if (machines.error) return { error: machines.error };
  if (!machines.library) return { note: "Loading machines..." };
  const { items } = machines.library;
  const machine = defaultMachine(settings, items);
  if (!machine)
    return {
      note: `No machines yet, ${UNCHECKED}. Add a mill on the Machines page.`,
    };
  if (machineKind(machine) === "mill") return { machine };
  const fix = items.some((item) => machineKind(item) === "mill")
    ? "Make a mill the default"
    : "Add a mill";
  return {
    note: `The default machine, ${machine.name}, is a laser, ${UNCHECKED}. ${fix} on the Machines page.`,
  };
}

function rpmProblem(preset: Preset, mill: Mill) {
  if (!("machine" in mill)) return [];
  const { min, max } = spindleRange(mill.machine);
  return preset.rpm >= min && preset.rpm <= max
    ? []
    : [
        `rpm must be within ${mill.machine.name}'s spindle range, ${min} to ${max} rpm`,
      ];
}

type SuggestProps = {
  ui: ClientUi;
  preset: Preset;
  tool: Tool | undefined;
  mill: Mill;
  edit: Edit;
};

type Done = { text: string; values: Partial<Preset> };

const SUGGESTED = [
  "rpm",
  "cutFeed",
  "plungeFeed",
  "rampFeed",
  "stepdown",
  "stepoverFraction",
] as const;

type Kept = Partial<Pick<Preset, (typeof SUGGESTED)[number]>>;

export function suggested(
  tool: Tool,
  material: string,
  machine: MachineProfile,
  kept: Kept = {},
) {
  const { rampFeed: _ramp, ...given } = kept;
  const { limits, stepdown, ...feeds } = suggestFeeds(
    tool,
    material,
    machine,
    given,
  );
  const plungeFeed = Math.round(feeds.plungeFeed);
  const values = {
    rpm: Math.round(feeds.rpm),
    cutFeed: Math.round(feeds.cutFeed),
    plungeFeed,
    rampFeed: plungeFeed,
    stepdown,
    stepoverFraction: Math.round(feeds.stepoverFraction * 100) / 100,
    ...kept,
  };
  const name = MATERIAL_OPTIONS.find(([id]) => id === material)![1];
  const applied = limits.map((limit) => limit.reason).join("; ");
  const text = `Suggested for ${name} on ${machine.name}${applied && `: ${applied}`}.`;
  return { text, values };
}

export function resuggested(
  tool: Tool,
  preset: Preset,
  material: string,
  from: MachineProfile,
  to: MachineProfile,
) {
  const base = suggested(tool, material, from).values;
  const kept = Object.fromEntries(
    SUGGESTED.filter((key) => preset[key] !== base[key]).map((key) => [
      key,
      preset[key],
    ]),
  );
  const { text, values } = suggested(tool, material, to, kept);
  const problems = rpmProblem({ ...preset, ...values }, { machine: to });
  return {
    text: [text, ...problems.map((problem) => `${problem}.`)].join(" "),
    preset: {
      ...preset,
      ...values,
      id: crypto.randomUUID(),
      name: `${preset.name} on ${to.name}`,
    },
  };
}

function withinMachine(preset: Preset, machine: MachineProfile): Preset {
  const { min, max } = spindleRange(machine);
  return {
    ...preset,
    rpm: Math.min(Math.max(preset.rpm, min), max),
    cutFeed: Math.min(preset.cutFeed, machine.maxFeedX, machine.maxFeedY),
    plungeFeed: Math.min(preset.plungeFeed, machine.maxFeedZ),
    rampFeed: Math.min(preset.rampFeed, machine.maxFeedZ),
  };
}

function seeded(count: number, tool: Tool | undefined, mill: Mill): Preset {
  const preset = newPreset(count, tool?.id);
  if (!("machine" in mill)) return preset;
  if (!tool) return withinMachine(preset, mill.machine);
  try {
    return {
      ...preset,
      ...suggested(tool, FIRST_MATERIAL, mill.machine).values,
    };
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return withinMachine(preset, mill.machine);
  }
}

const holds = (preset: Preset, done: Done | null) =>
  done &&
  Object.entries(done.values).every(
    ([key, value]) => preset[key as keyof Preset] === value,
  );

function Suggest({ ui, preset, tool, mill, edit }: SuggestProps) {
  const [material, setMaterial] = useState(FIRST_MATERIAL);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const machine = "machine" in mill ? mill.machine : undefined;
  const why =
    "note" in mill
      ? mill.note
      : machine && !tool
        ? "Pick a tool to suggest feeds."
        : holds(preset, done) && done!.text;
  const pick = (next: string) => {
    setMaterial(next);
    setDone(null);
    setError(null);
  };
  const run = () => {
    if (!tool || !machine) return;
    try {
      const next = suggested(tool, material, machine);
      edit({ ...preset, ...next.values });
      setDone(next);
      setError(null);
    } catch (e) {
      setDone(null);
      setError(`Suggest refused: ${reason(e)}.`);
    }
  };
  return h(
    Fragment,
    null,
    banner("error" in mill ? mill.error : error),
    h(ui.SelectField<string>, {
      label: "Material",
      value: material,
      options: MATERIAL_OPTIONS,
      onChange: pick,
    }),
    button("Suggest", "Suggest", !tool || !machine, run),
    why && h("span", { className: "field-hint" }, why),
  );
}

function toolOptions(tools: Tool[], current?: string): [string, string][] {
  const options: [string, string][] = [
    ["", "Any tool"],
    ...tools.map(({ id, name }): [string, string] => [id, name]),
  ];
  return current === undefined || tools.some(({ id }) => id === current)
    ? options
    : [...options, [current, "Deleted tool"]];
}

const linkedTo = ({ toolId: _link, ...preset }: Preset, toolId: string) =>
  toolId ? { ...preset, toolId } : preset;

const presetFields =
  (tools: Tool[], mill: Mill) => (ui: ClientUi, preset: Preset, edit: Edit) => {
    const { profile: _profile, ...cleared } = preset;
    const { toolId } = preset;
    const tool = tools.find(({ id }) => id === toolId);
    const num = (key: (typeof FEEDS)[number][0] | "rpm", label: string) =>
      h(ui.NumField, {
        key,
        label,
        value: preset[key],
        above: 0,
        onChange: (value) => edit({ ...preset, [key]: value }),
      });
    return [
      h(ui.TextField, {
        key: "name",
        label: "Name",
        value: preset.name,
        onChange: (name) => edit({ ...preset, name }),
      }),
      h(ui.SelectField<string>, {
        key: "tool",
        label: "Tool",
        value: toolId ?? "",
        options: toolOptions(tools, toolId),
        onChange: (id) => edit(linkedTo(preset, id)),
      }),
      toolId !== undefined &&
        !tool &&
        h(
          "span",
          { key: "deleted", className: "field-hint" },
          "Its tool was deleted, so no operation offers this preset. Link it to a tool or to Any tool.",
        ),
      h(Suggest, { key: "suggest", ui, preset, tool, mill, edit }),
      num("rpm", "Spindle speed (rpm)"),
      ...FEEDS.map(([key, label]) => num(key, label)),
      h(ui.LengthField, {
        key: "stepdown",
        label: "Stepdown",
        value: preset.stepdown,
        above: 0,
        onChange: (stepdown) => edit({ ...preset, stepdown }),
      }),
      h(ui.NumField, {
        key: "stepover",
        label: "Stepover (fraction of diameter)",
        value: preset.stepoverFraction,
        above: 0,
        max: 1,
        onChange: (stepoverFraction) => edit({ ...preset, stepoverFraction }),
      }),
      h(ui.SelectField<Coolant>, {
        key: "coolant",
        label: "Coolant",
        value: preset.coolant,
        options: COOLANTS,
        onChange: (coolant) => edit({ ...preset, coolant }),
      }),
      h(ui.NumField, {
        key: "profile",
        label: "Finishing profile",
        value: preset.profile,
        int: true,
        min: 1,
        max: 5,
        onChange: (next) => edit({ ...preset, profile: next }),
        onClear: () => edit(cleared),
      }),
    ];
  };

export const presetSection = (tools: Tool[], mill: Mill): Section<Preset> => ({
  noun: "preset",
  title: "Presets",
  create: (count) => seeded(count, undefined, mill),
  problems: (preset) => [
    ...validatePreset(preset),
    ...rpmProblem(preset, mill),
  ],
  fields: presetFields(tools, mill),
});

const presetRow = (state: State<Preset>, preset: Preset) =>
  row(
    { key: preset.id, name: preset.name },
    button("Edit", `Edit ${preset.name}`, state.pending, () =>
      state.setEditing(preset),
    ),
    button(
      "Delete",
      `Delete ${preset.name}`,
      state.pending,
      () => void state.remove(preset),
    ),
  );

export const newPresetButton = (state: State<Preset>, tool: Tool, mill: Mill) =>
  state.library &&
  button("New preset", `New preset for ${tool.name}`, state.pending, () =>
    state.setEditing(seeded(state.library!.items.length, tool, mill)),
  );

export function toolPresets(state: State<Preset>, tool: Tool): ReactNode {
  const own = state.library?.items.filter((p) => p.toolId === tool.id) ?? [];
  return h(
    "div",
    {
      key: `${tool.id}.presets`,
      className: "tree-children",
      role: "list",
      "aria-label": `${tool.name} presets`,
    },
    placeholder("presets", state, own.length),
    own.map((preset) => presetRow(state, preset)),
  );
}

export function otherPresets(state: State<Preset>, tools: Tool[]) {
  const known = new Set(tools.map(({ id }) => id));
  const other =
    state.library?.items.filter(
      ({ toolId }) => toolId === undefined || !known.has(toolId),
    ) ?? [];
  return (
    other.length > 0 &&
    tree(
      { title: "Other presets" },
      other.map((preset) => presetRow(state, preset)),
    )
  );
}
