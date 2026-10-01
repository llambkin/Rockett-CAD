import { useStore, type Selection } from "../store";
import { commandById, type CommandContext } from "./registry";
import type { ViewportRef } from "../viewportRef";
import type { FeatureCommandState } from "./featureCommand";
import type { MeasureState } from "./measure";

export type Active =
  | { id: "inspect.measure"; state: MeasureState; editTarget?: string }
  | { id: "design.sketch.create"; state?: never }
  | { id: "design.feature"; state: FeatureCommandState }
  | { id: "design.export"; state: { selectionBefore: Selection[] } };

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

export function exitActive() {
  activeCommand()?.exit();
}
