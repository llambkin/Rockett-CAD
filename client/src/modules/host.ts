import { createElement } from "react";
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

type Dispose = () => void;

const guarded = (command: Command): Command => {
  const { Control } = command;
  if (!Control) return command;
  const panel = { id: command.id, title: command.label };
  return {
    ...command,
    Control: () =>
      createElement(PanelBoundary, { panel, children: createElement(Control) }),
  };
};

function registrars(own: Dispose[]) {
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  return {
    command: track((command: Command) => registerCommand(guarded(command))),
    toolbarGroup: track(registerToolbarGroup),
    panel: track(registerPanel),
    workbench: track(registerWorkbench),
    selectionKind: track(registerSelectionKind),
    pickProvider: track(registerPickProvider),
  };
}

export interface ModuleContext {
  register: ReturnType<typeof registrars>;
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
      await module.client.activate({ register: registrars(own) });
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
