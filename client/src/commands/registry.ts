import { useSyncExternalStore, type ComponentType } from "react";
import { createRegistry } from "@rockett/shared";
import type { ActiveCommand } from "./active";
import type { IconId } from "../icons";
import { useStore } from "../store";

export type CommandContext = ReturnType<typeof useStore.getState>;

interface Anchored {
  id: string;
  after?: string;
  before?: string;
}

interface CommandBase extends Anchored {
  label: string;
  interaction?: ActiveCommand;
  when?(ctx: CommandContext): boolean;
  enabled?(ctx: CommandContext): true | string;
}

type Keyed =
  | { keys?: never; keyContext?: never }
  | { keys: readonly string[]; keyContext: string };

interface CommandButton {
  group: string;
  icon: IconId;
  tooltip?: string;
  primary?: true;
  active?(ctx: CommandContext): boolean;
  run(ctx: CommandContext): unknown;
  Control?: never;
}

interface CommandControl {
  group: string;
  Control: ComponentType;
  run?: never;
  icon?: never;
}

interface CommandAction {
  group?: never;
  icon?: never;
  Control?: never;
  run(ctx: CommandContext): unknown;
}

export type Command = CommandBase &
  Keyed &
  (CommandButton | CommandControl | CommandAction);
export type ToolbarCommand = CommandBase &
  Keyed &
  (CommandButton | CommandControl);

export interface ToolbarGroup extends Anchored {
  label: string;
  context: string;
  end?: true;
}

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

export function runCommand(id: string): unknown {
  const command = commandRegistry.get(id);
  const ctx = useStore.getState();
  if (!command?.run || !runnable(command, ctx)) return;
  return command.run(ctx);
}

export function tooltipOf(command: {
  label: string;
  tooltip?: string | undefined;
  keys?: readonly string[] | undefined;
}): string {
  const text = command.tooltip ?? command.label;
  const key = command.keys?.[0];
  return key ? `${text} (${key})` : text;
}

function placed<T extends Anchored>(items: readonly T[]): T[] {
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
  return placed(groupRegistry.list().filter((g) => g.context === context)).map(
    (group) => ({
      group,
      commands: placed(shown.filter((c) => c.group === group.id)),
    }),
  );
}

export function useRegistrations(): void {
  const { subscribe: onCommand, snapshot: allCommands } = commandRegistry;
  const { subscribe: onGroup, snapshot: allGroups } = groupRegistry;
  useSyncExternalStore(onCommand, allCommands, allCommands);
  useSyncExternalStore(onGroup, allGroups, allGroups);
}
