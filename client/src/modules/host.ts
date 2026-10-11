import { createElement, useCallback, type ComponentType } from "react";
import type {
  ClientContext,
  ClientUi,
  Dispose,
  FaceRef,
  Layer,
  MenuItem,
  ModuleSettings,
  NumberFieldProps,
  OpenProject,
  PickMode,
  PickRef,
  ProjectView,
  RouteResponse,
  SettingDefinition,
  SettingsPage,
  Workbench,
} from "@rockett/plugin-api";
import {
  checkModuleSetting,
  DOCUMENT_EDITS,
  formatAngle,
  formatLength,
  formatPower,
  moduleHiddenSetting,
  moduleHostSettings,
  nameSection,
  REGISTRY_ID,
  registerModuleSetting,
  registerSettings,
  SETTINGS,
  type ModuleInfo,
  type Route,
  type SettingOwner,
} from "@rockett/shared";
import { api, request, send, type MutationResponse } from "../api";
import { activeOwner } from "../commands/active";
import { isMenu, registerMenuItem } from "../commands/menus";
import {
  registerCommand,
  registerToolbarGroup,
  type Command,
} from "../commands/registry";
import { iconOf, registerModuleIcon } from "../icons";
import { registerSelectionKind } from "../selection/kinds";
import { confirm } from "../components/ConfirmPanel";
import { ContextMenu } from "../components/ContextMenu";
import { pickFile, saveDownload } from "../download";
import { DraggablePanel } from "../components/DraggablePanel";
import {
  openSettings,
  registerSettingsPage,
} from "../components/SettingsPanel";
import { DialogFooter } from "../components/form/DialogFooter";
import { measureRef } from "../components/selectionMeasure";
import { pickMode } from "./pick";
import { thirdPartyModules } from "./thirdParty";
import {
  AngleField,
  CheckField,
  LengthField,
  NumField,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/form/fields";
import {
  getSetting,
  publish,
  setSetting,
  subscribe,
  useSetting,
} from "../settings";
import {
  closePanel,
  openPanel,
  PanelBoundary,
  registerPanel,
} from "../shell/panels";
import { registerWorkbench } from "../shell/workbench";
import { useStore, type State } from "../store";
import { registerPickProvider } from "../three/pickProviders";
import { registerLayer } from "../three/sceneLayers";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const bounded =
  (id: string, title: string, Inner: ComponentType): ComponentType =>
  () =>
    createElement(PanelBoundary, {
      panel: { id, title },
      children: createElement(Inner),
    });

const guarded = (command: Command): Command =>
  command.Control
    ? {
        ...command,
        Control: bounded(command.id, command.label, command.Control),
      }
    : command;

const guardedWorkbench = ({ tree, bar, ...workbench }: Workbench) => ({
  ...workbench,
  ...(tree && { tree: bounded(workbench.id, workbench.label, tree) }),
  ...(bar && { bar: bounded(workbench.id, workbench.label, bar) }),
});

const guardedLayer = ({ id, mount }: Layer): Layer => ({
  id,
  mount(layer) {
    try {
      return mount(layer);
    } catch (error) {
      console.error(`[rockett] layer ${id} failed: ${messageOf(error)}`);
    }
  },
});

const ICON_FILE = /\/icons\/([a-z0-9-]+)\.svg$/;

function registerModuleIcons(own: Dispose[], { manifest, icons }: HostModule) {
  for (const [path, file] of Object.entries(icons ?? {})) {
    const name = ICON_FILE.exec(path)?.[1];
    if (!name) throw new Error(`icon ${path} must be icons/<name>.svg`);
    own.push(registerModuleIcon(`${manifest.id}/${name}.svg`, file));
  }
}

type ModuleCommand = Command & { icon?: `${string}.svg` };

function iconed(moduleId: string, command: ModuleCommand): Command {
  if (!command.icon) return command;
  const icon = `${moduleId}/${command.icon}` as const;
  if (!iconOf(icon))
    throw new Error(
      `command ${command.id} icon ${command.icon} is not in ${moduleId} icons/`,
    );
  return { ...command, icon };
}

const owned = (command: Command): Command => ({
  ...command,
  active: (s) => activeOwner(s) === command.id,
});

function ownId(moduleId: string, kind: string, id: string) {
  if (!id.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(id))
    throw new Error(
      `${kind} ${id} must start with ${moduleId}. and name a valid id`,
    );
}

function registerModuleLayer(moduleId: string, layer: Layer) {
  ownId(moduleId, "layer", layer.id);
  return registerLayer(guardedLayer(layer));
}

function registerModuleMenuItem(moduleId: string, { menu, ...item }: MenuItem) {
  ownId(moduleId, "menu item", item.id);
  if (!isMenu(menu))
    throw new Error(`menu item ${item.id} names unknown menu ${menu}`);
  return registerMenuItem({ ...item, surface: menu });
}

function registerClientSetting(
  manifest: SettingOwner,
  definition: SettingDefinition,
) {
  const dispose = registerModuleSetting(manifest, definition);
  publish();
  return () => {
    dispose();
    publish();
  };
}

function registerModulePage(moduleId: string, page: SettingsPage) {
  ownId(moduleId, "settings page", page.id);
  return registerSettingsPage({
    ...page,
    section: `plugin:${moduleId}`,
    component: bounded(page.id, page.title, page.component),
  });
}

type Viewed = Pick<State, "projectId" | "document" | "evaluation">;

const changed = (now: Viewed, before: Viewed) =>
  now.projectId !== before.projectId ||
  now.document !== before.document ||
  now.evaluation !== before.evaluation;

let seen: Viewed = { projectId: null, document: null, evaluation: null };
let open: OpenProject = { projectId: null, document: null, bodies: [] };
let picked: { from: State["selection"]; faces: readonly FaceRef[] } = {
  from: [],
  faces: [],
};
let refs: { from: State["selection"]; refs: readonly PickRef[] } = {
  from: [],
  refs: [],
};

async function inOpenProject<T>(call: (id: string) => Promise<T>) {
  const { projectId } = useStore.getState();
  if (!projectId) throw new Error("No project is open.");
  const reply = await call(projectId);
  if (useStore.getState().projectId !== projectId)
    throw new Error("The open project changed.");
  return reply;
}

const project: Omit<ProjectView, "pick"> = {
  get() {
    const now = useStore.getState();
    if (!changed(now, seen)) return open;
    const { projectId, document, evaluation } = now;
    seen = { projectId, document, evaluation };
    const bodies = (evaluation?.bodies ?? []).map(
      ({ bodyId, name, reference, bbox }) => ({
        id: bodyId,
        name,
        ...(reference && { reference }),
        bbox,
      }),
    );
    open = { projectId, document, bodies };
    return open;
  },
  selection() {
    const { selection } = useStore.getState();
    if (selection === picked.from) return picked.faces;
    const faces = selection.flatMap((s) =>
      s.kind === "face"
        ? [{ kind: s.kind, bodyId: s.bodyId, faceName: s.faceName }]
        : [],
    );
    picked = { from: selection, faces };
    return faces;
  },
  picks() {
    const { selection } = useStore.getState();
    if (selection !== refs.from)
      refs = {
        from: selection,
        refs: selection.flatMap((s) => measureRef(s) ?? []),
      };
    return refs.refs;
  },
  select: (picks) => useStore.getState().setSelection([...picks]),
  subscribe: (listener) =>
    useStore.subscribe((now, before) => {
      if (changed(now, before) || now.selection !== before.selection)
        listener();
    }),
  read: (route, params) =>
    inOpenProject(async (id) => {
      if (route.method !== "GET")
        throw new Error(`${route.path} is not a GET route`);
      const get = route as Route<string, unknown, RouteResponse<typeof route>>;
      return send(get, { ...params, id });
    }),
  async mutate(route, body) {
    const { projectId, mutate } = useStore.getState();
    if (!projectId) throw new Error("No project is open.");
    if (!DOCUMENT_EDITS(route))
      throw new Error(`${route.path} is not a document edit`);
    const edit = route as Route<string, unknown, MutationResponse>;
    await mutate((tx) => send(edit, { id: projectId }, { body, tx }));
  },
  measure: (picks) => inOpenProject((id) => api.measure(id, [...picks])),
};

const ModuleLengthField = (props: NumberFieldProps & { label: string }) =>
  createElement(LengthField, { ...props, units: useSetting("units.length") });

function useFormatLength() {
  const units = useSetting("units.length");
  return useCallback(
    (mm: number, power?: 2 | 3) =>
      power ? formatPower(mm, units, power) : formatLength(mm, units),
    [units],
  );
}

const modulePanel = (moduleId: string): ClientUi["DraggablePanel"] =>
  function ModulePanel(props) {
    if (props.id) ownId(moduleId, "panel", props.id);
    return createElement(DraggablePanel, props);
  };

const ui: Omit<ClientUi, "DraggablePanel"> = {
  DialogFooter,
  NumField,
  LengthField: ModuleLengthField,
  AngleField,
  useFormatLength,
  formatAngle,
  SelectField,
  CheckField,
  TextField,
  TextAreaField,
  ContextMenu,
  openPanel,
  closePanel,
  openSettings: (page) => openSettings({ page }),
  confirm,
  showError: (message) => useStore.getState().setError(message),
  download: ({ fileName, data, type }) =>
    saveDownload({ blob: new Blob([data], { type }), fileName }),
  pickFile,
};

const ROUTE_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

const moduleRequest =
  (moduleId: string): ClientContext["request"] =>
  async (method, path, body) => {
    if (!ROUTE_PATH.test(path))
      throw new Error(`${path} is not a route of ${moduleId}`);
    const prefix = `/m/${moduleId.replaceAll(".", "/")}/`;
    return request(method, prefix + path, { body });
  };

function moduleSettings(
  manifest: SettingOwner,
  track: (dispose: Dispose) => Dispose,
): ModuleSettings {
  const own = (key: string) => {
    checkModuleSetting(manifest, key);
    return key;
  };
  return {
    get: (key) => getSetting(own(key)) as never,
    set: async (key, value) => setSetting(own(key), value as never),
    subscribe: (key, listener) => track(subscribe(own(key), listener)),
  };
}

type Shown = { show: () => Dispose; hide: Dispose | null };

function hideable(own: Dispose[], moduleId: string) {
  const { key } = moduleHiddenSetting(moduleId);
  const entries = new Set<Shown>();
  own.push(
    subscribe(key, (hidden) => {
      for (const entry of entries) {
        if (hidden !== true) entry.hide ??= entry.show();
        else if (entry.hide) {
          entry.hide();
          entry.hide = null;
        }
      }
    }),
  );
  return <T>(register: (item: T) => Dispose) =>
    (item: T): Dispose => {
      const entry: Shown = { show: () => register(item), hide: null };
      if (getSetting(key) !== true) entry.hide = entry.show();
      entries.add(entry);
      const dispose = () => {
        entries.delete(entry);
        entry.hide?.();
        entry.hide = null;
      };
      own.push(dispose);
      return dispose;
    };
}

function moduleContext(own: Dispose[], manifest: SettingOwner) {
  const moduleId = manifest.id;
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      const release = () => {
        const at = own.indexOf(release);
        if (at < 0) return;
        own.splice(at, 1);
        dispose();
      };
      own.push(release);
      return release;
    };
  const shown = hideable(own, moduleId);
  const command = shown(registerCommand);
  const workbench = shown(registerWorkbench);
  const register = {
    command: (item: ModuleCommand) =>
      command(guarded(owned(iconed(moduleId, item)))),
    toolbarGroup: shown(registerToolbarGroup),
    menuItem: track((item: MenuItem) => registerModuleMenuItem(moduleId, item)),
    panel: shown(registerPanel),
    workbench: (item: Workbench) => workbench(guardedWorkbench(item)),
    selectionKind: track(registerSelectionKind),
    pickProvider: track(registerPickProvider),
    layer: track((layer: Layer) => registerModuleLayer(moduleId, layer)),
    setting: track((definition: SettingDefinition) =>
      registerClientSetting(manifest, definition),
    ),
    settingsPage: track((page: SettingsPage) =>
      registerModulePage(moduleId, page),
    ),
  };
  return {
    register,
    project: {
      ...project,
      subscribe: track(project.subscribe),
      pick(mode: PickMode) {
        const release = track(pickMode)(moduleId, mode, () => release());
        return release;
      },
    },
    ui: { ...ui, DraggablePanel: modulePanel(moduleId) },
    settings: moduleSettings(
      manifest,
      track((dispose: Dispose) => dispose),
    ),
    request: moduleRequest(moduleId),
  };
}

export interface ModuleContext extends ClientContext {
  register: ReturnType<typeof moduleContext>["register"];
}

export interface HostModule {
  manifest: SettingOwner & { name: string };
  client: { activate(context: ModuleContext): void | Promise<void> };
  icons?: Readonly<Record<string, string>>;
}

const disposeAll = (disposers: readonly Dispose[]) => {
  for (const dispose of disposers.toReversed()) dispose();
};

const registerHostSettings = (modules: readonly HostModule[]) => {
  for (const { manifest } of modules)
    registerSettings(
      moduleHostSettings(manifest.id).filter(({ key }) => !SETTINGS.has(key)),
    );
};

export async function loadClientModules(
  modules: readonly HostModule[],
  report: () => Promise<readonly ModuleInfo[]>,
): Promise<Dispose> {
  registerHostSettings(modules);
  const reports = await report().catch((error: Error) => {
    useStore.getState().setError(error.message);
    return [];
  });
  const plugins = thirdPartyModules(reports);
  registerHostSettings(plugins);
  if (plugins.length > 0) publish();
  const loaded = new Set(
    reports.filter((m) => m.status === "loaded").map((m) => m.id),
  );
  const disposers: Dispose[] = [];
  for (const module of [...modules, ...plugins]) {
    if (!loaded.has(module.manifest.id)) continue;
    const own: Dispose[] = [];
    try {
      own.push(
        nameSection(`plugin:${module.manifest.id}`, module.manifest.name),
      );
      registerModuleIcons(own, module);
      await module.client.activate(moduleContext(own, module.manifest));
      disposers.push(() => disposeAll(own));
    } catch (error) {
      disposeAll(own);
      console.error(
        `[rockett] module ${module.manifest.id} failed: ${messageOf(error)}`,
      );
    }
  }
  return () => disposeAll(disposers);
}
