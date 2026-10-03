import { createElement, type ComponentType } from "react";
import type {
  ClientContext,
  Dispose,
  OpenProject,
  ProjectView,
  Workbench,
} from "@rockett/plugin-api";
import type { ModuleInfo } from "@rockett/shared";
import {
  registerCommand,
  registerToolbarGroup,
  type Command,
} from "../commands/registry";
import { registerSelectionKind } from "../selection/kinds";
import { PanelBoundary, registerPanel } from "../shell/panels";
import { registerWorkbench } from "../shell/workbench";
import { useStore } from "../store";
import { registerPickProvider } from "../three/pickProviders";

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

let open: OpenProject = { projectId: null, document: null };

const project: ProjectView = {
  get() {
    const { projectId, document } = useStore.getState();
    if (projectId !== open.projectId || document !== open.document)
      open = { projectId, document };
    return open;
  },
  subscribe: (listener) =>
    useStore.subscribe((now, before) => {
      if (
        now.projectId !== before.projectId ||
        now.document !== before.document
      )
        listener();
    }),
};

function moduleContext(own: Dispose[]) {
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  const register = {
    command: track((command: Command) => registerCommand(guarded(command))),
    toolbarGroup: track(registerToolbarGroup),
    panel: track(registerPanel),
    workbench: track((workbench: Workbench) =>
      registerWorkbench(guardedWorkbench(workbench)),
    ),
    selectionKind: track(registerSelectionKind),
    pickProvider: track(registerPickProvider),
  };
  return {
    register,
    project: { ...project, subscribe: track(project.subscribe) },
  };
}

export interface ModuleContext extends ClientContext {
  register: ReturnType<typeof moduleContext>["register"];
}

export interface HostModule {
  manifest: { id: string };
  client: { activate(context: ModuleContext): void | Promise<void> };
}

const disposeAll = (disposers: readonly Dispose[]) => {
  for (const dispose of disposers.toReversed()) dispose();
};

export async function loadClientModules(
  modules: readonly HostModule[],
  report: () => Promise<readonly ModuleInfo[]>,
): Promise<Dispose> {
  const reports = await report().catch((error: Error) => {
    useStore.getState().setError(error.message);
    return [];
  });
  const loaded = new Set(
    reports.filter((m) => m.status === "loaded").map((m) => m.id),
  );
  const disposers: Dispose[] = [];
  for (const module of modules) {
    if (!loaded.has(module.manifest.id)) continue;
    const own: Dispose[] = [];
    try {
      await module.client.activate(moduleContext(own));
      disposers.push(() => disposeAll(own));
    } catch (error) {
      disposeAll(own);
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[rockett] module ${module.manifest.id} failed: ${message}`,
      );
    }
  }
  return () => disposeAll(disposers);
}
