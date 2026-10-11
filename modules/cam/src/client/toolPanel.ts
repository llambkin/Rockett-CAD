import { createElement as h, Fragment, useState, type ReactNode } from "react";
import type { ClientContext, UserDataEntry } from "@rockett/plugin-api";
import type { Post } from "../post/schema.js";
import {
  newMachine,
  validateMachine,
  type MachineProfile,
} from "../shared/machine.js";
import { DEFAULT_MACHINE, defaultMachine } from "../shared/settings.js";
import { validateTool, type Preset, type Tool } from "../shared/tools.js";
import {
  exportTools,
  importRockett,
  merge,
  TOOLS_FILE,
  type ToolImport,
} from "../import/rockett.js";
import {
  banner,
  button,
  deleteQuestion,
  dimmed,
  libraryOf,
  placeholder,
  reason,
  row,
  tree,
  useModuleSetting,
  useStored,
} from "./libraryParts.js";
import { machineForm } from "./machineForm.js";
import {
  newPresetButton,
  otherPresets,
  presetSection,
  toolPresets,
  useDefaultMill,
} from "./presetForm.js";
import { newTool, toolFields } from "./toolForm.js";

type Ui = ClientContext["ui"];
type Item = { id: string; name: string };

export type Section<T extends Item> = {
  noun: string;
  title: string;
  create(count: number): T;
  problems(item: T): string[];
  fields(ui: Ui, item: T, edit: (item: T) => void): ReactNode[];
};

export const saved = <T extends Item>(items: T[], item: T) =>
  items.some((t) => t.id === item.id)
    ? items.map((t) => (t.id === item.id ? item : t))
    : [...items, item];

const TOOLS: Section<Tool> = {
  noun: "tool",
  title: "Tools",
  create: newTool,
  problems: validateTool,
  fields: toolFields,
};

export const machineSection = (
  posts: Post[],
  postsError: string | null = null,
): Section<MachineProfile> => ({
  noun: "machine",
  title: "Machines",
  create: newMachine,
  problems: validateMachine,
  fields: machineForm(posts, postsError),
});

export function useSection<T extends Item>(
  { ui, request }: ClientContext,
  section: Section<T>,
) {
  const path = `${section.noun}s`;
  const { library, setLibrary, error, setError } = useStored<T>(
    request,
    path,
    section.title,
  );
  const [editing, setEditing] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const reload = () =>
    request<UserDataEntry | null>("GET", path)
      .then(libraryOf<T>)
      .then((next) => {
        setLibrary(next);
        return next;
      });
  const write = (items: T[], etag = library!.etag) => {
    setPending(true);
    return request<UserDataEntry>("PUT", path, { data: items, etag })
      .then(libraryOf<T>)
      .then(
        (next) => {
          setLibrary(next);
          setError(null);
          setEditing(null);
          return true;
        },
        (e) => {
          setError(`${section.title} did not save: ${reason(e)}.`);
          return false;
        },
      )
      .finally(() => setPending(false));
  };
  const remove = async (item: T) => {
    if (await ui.confirm(deleteQuestion(item.name)))
      await write(library!.items.filter((t) => t.id !== item.id));
  };
  return {
    section,
    library,
    error,
    editing,
    pending,
    setError,
    setEditing,
    reload,
    write,
    remove,
  };
}

export type State<T extends Item> = ReturnType<typeof useSection<T>>;

function sectionForm<T extends Item>(ui: Ui, state: State<T>) {
  const { section, library, editing, pending } = state;
  if (!library || !editing) return null;
  const problems = section.problems(editing);
  return h(
    Fragment,
    null,
    banner(state.error),
    section.fields(ui, editing, state.setEditing),
    problems.length > 0 &&
      h(
        "span",
        { className: "field-hint" },
        `Fix before saving: ${problems.join("; ")}.`,
      ),
    h(ui.DialogFooter, {
      onOk: () => void state.write(saved(library.items, editing)),
      onCancel: () => state.setEditing(null),
      pending,
      okDisabled: problems.length > 0,
    }),
  );
}

function sectionList<T extends Item>(
  state: State<T>,
  extra?: ReactNode,
  mark?: (item: T) => ReactNode,
  after?: (item: T) => ReactNode,
) {
  const { section, library, error, pending } = state;
  const plural = section.title.toLowerCase();
  const rows = library?.items.map((item) =>
    h(
      Fragment,
      { key: item.id },
      row(
        { key: item.id, name: item.name },
        mark?.(item),
        button("Edit", `Edit ${item.name}`, pending, () =>
          state.setEditing(item),
        ),
        button(
          "Delete",
          `Delete ${item.name}`,
          pending,
          () => void state.remove(item),
        ),
      ),
      after?.(item),
    ),
  );
  const add = `Add ${section.noun}`;
  return h(
    Fragment,
    { key: section.noun },
    banner(error),
    tree(
      { title: `Your ${plural}` },
      placeholder(plural, state, rows?.length),
      rows,
    ),
    library &&
      button(add, add, pending, () =>
        state.setEditing(section.create(library.items.length)),
      ),
    extra,
  );
}

type ImportView = {
  name: string;
  result: ToolImport;
  tools: Tool[];
  presets: Preset[];
  replace: boolean;
  error: string | null;
  pending: boolean;
  setReplace(replace: boolean): void;
  onOk(): void;
  onCancel(): void;
};

function importRows<T extends Item>(
  items: T[],
  incoming: T[],
  replace: boolean,
) {
  const known = new Set(items.map((item) => item.id));
  return incoming.map((item) =>
    row(
      { key: item.id, name: item.name },
      h(
        "span",
        null,
        !known.has(item.id)
          ? "New"
          : replace
            ? "Replaces yours"
            : "Skipped, already in your library",
      ),
    ),
  );
}

export function importDialog(ui: Ui, view: ImportView) {
  const { result, replace } = view;
  const unchanged =
    merge(view.tools, result.tools, replace) === view.tools &&
    merge(view.presets, result.presets, replace) === view.presets;
  return h(
    Fragment,
    null,
    h("span", { className: "field-hint" }, `Import ${view.name}`),
    banner(view.error),
    result.tools.length > 0 &&
      tree({ title: "Tools" }, importRows(view.tools, result.tools, replace)),
    result.presets.length > 0 &&
      tree(
        { title: "Presets" },
        importRows(view.presets, result.presets, replace),
      ),
    result.rejects.length > 0 &&
      tree(
        { title: "Rejected" },
        result.rejects.map((reject, index) =>
          row(
            { key: String(index), name: reject.item },
            h("span", null, reject.reason),
          ),
        ),
      ),
    h(ui.CheckField, {
      label: "Replace tools and presets with the same id",
      value: replace,
      onChange: view.setReplace,
    }),
    h(ui.DialogFooter, {
      onOk: view.onOk,
      onCancel: view.onCancel,
      okLabel: "Import",
      okDisabled: unchanged,
      pending: view.pending,
    }),
  );
}

type Importing = { name: string; result: ToolImport; replace: boolean };

async function pickImport(context: ClientContext): Promise<Importing | null> {
  const file = await context.ui.pickFile({
    accept: ".json,application/json",
    maxBytes: Infinity,
  });
  if (!file) return null;
  return { name: file.name, result: importRockett(file.text), replace: false };
}

function useTransfer(
  context: ClientContext,
  tools: State<Tool>,
  presets: State<Preset>,
) {
  const { ui } = context;
  const [importing, setImporting] = useState<Importing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = tools.library?.items;
  const stored = presets.library?.items;
  const fresh = (doing: string) =>
    presets.reload().catch((e) => {
      setError(`${doing} did not read your presets: ${reason(e)}.`);
      return null;
    });
  const pick = () =>
    pickImport(context).then(
      async (next) => {
        if (!next || !(await fresh("Import"))) return;
        setError(null);
        setImporting(next);
      },
      (e) => setError(`Import did not start: ${reason(e)}.`),
    );
  const run = async ({ result, replace }: Importing) => {
    const nextTools = merge(items!, result.tools, replace);
    if (nextTools !== items && !(await tools.write(nextTools))) return;
    const read = await fresh("Import");
    if (!read) return;
    const next = merge(read.items, result.presets, replace);
    if (next !== read.items && !(await presets.write(next, read.etag))) return;
    setImporting(null);
  };
  const exportFile = async (list: Tool[]) => {
    const read = await fresh("Export");
    if (!read) return;
    ui.download({
      fileName: TOOLS_FILE,
      data: exportTools(list, read.items),
      type: "application/json",
    });
  };
  const busy = tools.pending || presets.pending;
  const buttons =
    items &&
    stored &&
    h(
      Fragment,
      null,
      banner(error),
      button("Import tools", "Import tools", busy, () => void pick()),
      button(
        "Export tools",
        "Export tools",
        busy,
        () => void exportFile(items),
      ),
    );
  const dialog =
    importing &&
    items &&
    stored &&
    importDialog(ui, {
      name: importing.name,
      result: importing.result,
      replace: importing.replace,
      tools: items,
      presets: stored,
      error: error ?? tools.error ?? presets.error,
      pending: busy,
      setReplace: (replace) => setImporting({ ...importing, replace }),
      onOk: () => void run(importing),
      onCancel: () => {
        setError(null);
        setImporting(null);
      },
    });
  return { buttons, dialog };
}

export function toolsPage(context: ClientContext) {
  const { ui } = context;
  return function ToolsPage() {
    const tools = useSection(context, TOOLS);
    const items = tools.library?.items ?? [];
    const mill = useDefaultMill(context);
    const presets = useSection(context, presetSection(items, mill));
    const transfer = useTransfer(context, tools, presets);
    return (
      transfer.dialog ||
      sectionForm(ui, presets) ||
      sectionForm(ui, tools) ||
      h(
        Fragment,
        null,
        banner(presets.error),
        sectionList(
          tools,
          h(Fragment, null, otherPresets(presets, items), transfer.buttons),
          (tool) => newPresetButton(presets, tool, mill),
          (tool) => toolPresets(presets, tool),
        ),
      )
    );
  };
}

export function machinesPage(context: ClientContext) {
  const { ui, request, settings } = context;
  return function MachinesPage() {
    const posts = useStored<Post>(request, "posts", "Posts");
    const machines = useSection(
      context,
      machineSection(posts.library?.items ?? [], posts.error),
    );
    useModuleSetting(settings, DEFAULT_MACHINE.key);
    const [error, setError] = useState<string | null>(null);
    const chosen = defaultMachine(settings, machines.library?.items ?? []);
    const makeDefault = (machine: MachineProfile) =>
      settings.set(DEFAULT_MACHINE.key, machine.id).then(
        () => setError(null),
        (e) => setError(`Default machine did not save: ${reason(e)}.`),
      );
    const mark = (machine: MachineProfile) =>
      machine === chosen
        ? dimmed("Default")
        : button(
            "Make default",
            `Make ${machine.name} the default machine`,
            machines.pending,
            () => void makeDefault(machine),
          );
    return (
      sectionForm(ui, machines) ||
      h(Fragment, null, banner(error), sectionList(machines, null, mark))
    );
  };
}
