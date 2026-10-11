import { useSyncExternalStore } from "react";
import {
  EVERY_WORKBENCH,
  type Anchored,
  type CommandAction,
  type CommandBase as Base,
  type CommandControl,
  type Keyed,
  type ToolbarGroup,
} from "@rockett/plugin-api";
import { createRegistry } from "@rockett/shared";
import type { ActiveCommand } from "./active";
import type { ViewportRef } from "../viewportRef";
import type { IconId } from "../icons";
import { useStore } from "../store";

export type CommandContext = ReturnType<typeof useStore.getState> & {
  viewport?: ViewportRef;
};

interface CommandBase extends Base<CommandContext> {
  interaction?: ActiveCommand;
  description?: string;
  active?(ctx: CommandContext): boolean;
}

interface CommandButton {
  group: string;
  icon: IconId;
  tooltip?: string;
  primary?: true;
  iconOnly?: true;
  explainsRefusal?: true;
  run(ctx: CommandContext): unknown;
  Control?: never;
}

export type Command = CommandBase &
  Keyed &
  (CommandButton | CommandControl | CommandAction<CommandContext>);
export type ToolbarCommand = CommandBase &
  Keyed &
  (CommandButton | CommandControl);
export type { ToolbarGroup };

const commandRegistry = createRegistry<Command>("command", (c) => c.id);
const groupRegistry = createRegistry<ToolbarGroup>(
  "toolbar group",
  (g) => g.id,
);

export const registerCommand = commandRegistry.register;
export const commandById = commandRegistry.get;
export const registerToolbarGroup = groupRegistry.register;
export const commands = commandRegistry.list;
export const toolbarGroups = groupRegistry.list;

export function runnable(command: Command, ctx: CommandContext): boolean {
  if (!command.run || command.when?.(ctx) === false) return false;
  return (command.enabled?.(ctx) ?? true) === true;
}

export function runCommand(id: string, viewport?: ViewportRef): unknown {
  const command = commandRegistry.get(id);
  const ctx: CommandContext = {
    ...useStore.getState(),
    ...(viewport && { viewport }),
  };
  if (!command?.run || !runnable(command, ctx)) return;
  return command.run(ctx);
}

export function placed<T extends Anchored>(items: readonly T[]): T[] {
  const out = items.filter((i) => !i.after && !i.before);
  let rest = items.filter((i) => i.after || i.before);
  while (rest.length > 0) {
    const waiting = rest.filter((i) => {
      const at = out.findIndex((o) => o.id === (i.after ?? i.before));
      if (at < 0) return true;
      out.splice(i.after ? at + 1 : at, 0, i);
      return false;
    });
    if (waiting.length === rest.length) return [...out, ...waiting];
    rest = waiting;
  }
  return out;
}

export function toolbarFor(context: string, ctx: CommandContext) {
  const shown = commandRegistry
    .list()
    .filter((c): c is ToolbarCommand => !!c.group && c.when?.(ctx) !== false);
  const workbenchRow = context !== ctx.active?.id;
  const groups = groupRegistry
    .list()
    .filter(
      (g) =>
        g.context === context ||
        (workbenchRow && g.context === EVERY_WORKBENCH),
    );
  return placed(groups).map((group) => ({
    group,
    commands: placed(shown.filter((c) => c.group === group.id)),
  }));
}

export function useRegistrations(): void {
  const { subscribe: onCommand, snapshot: allCommands } = commandRegistry;
  const { subscribe: onGroup, snapshot: allGroups } = groupRegistry;
  useSyncExternalStore(onCommand, allCommands, allCommands);
  useSyncExternalStore(onGroup, allGroups, allGroups);
}
