import type { PickMode } from "@rockett/plugin-api";
import { useStore, type Selection } from "../store";
import { commandById, type CommandContext } from "./registry";
import type { ViewportRef } from "../viewportRef";
import type { FeatureCommandState } from "./featureCommand";
import type { SketchState } from "./sketch";

export type Active =
  | { id: "design.sketch"; state: SketchState }
  | { id: "design.sketch.create"; state?: never }
  | { id: "design.feature"; state: FeatureCommandState }
  | { id: "design.export"; state: { selectionBefore: Selection[] } }
  | { id: "module.pick"; state: PickMode };

export type PickModifiers = Pick<
  PointerEvent,
  "shiftKey" | "ctrlKey" | "metaKey"
>;

export interface ActiveCommand {
  enter(): void;
  exit(): void;
  pickFilter(event?: Pick<PointerEvent, "shiftKey">): readonly string[];
  onHover(selection: Selection | null, event: PickModifiers): Selection | null;
  onClick(
    selection: Selection | null,
    event: PickModifiers,
    viewport?: ViewportRef,
  ): Promise<void>;
  onSelection?(selection: readonly Selection[], additive: boolean): void;
  onRange?(range: readonly Selection[]): void;
  onContextMenu(selection: Selection | null, event: PointerEvent): void;
  hint: string;
  panel?: string;
  banner?: string;
  keyContext: string;
}

export function activeCommand(
  { active }: CommandContext = useStore.getState(),
) {
  return active ? commandById(active.id)?.interaction : undefined;
}

export const activeOwner = ({ active }: CommandContext) =>
  active?.id === "module.pick" ? active.state.command : active?.id;

export function exitActive() {
  activeCommand()?.exit();
}
