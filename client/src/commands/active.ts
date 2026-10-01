import type { CadViewport } from "../three/CadViewport";
import { useStore, type Selection } from "../store";
import { commandById, type CommandContext } from "./registry";
import type { MeasureState } from "./measure";

export type Active =
  | { id: "inspect.measure"; state: MeasureState; editTarget?: string }
  | { id: "design.sketch.create"; state?: never };

export interface ActiveCommand {
  enter(): void;
  exit(): void;
  pickFilter: Parameters<CadViewport["pick"]>[2];
  onHover(selection: Selection | null, event: PointerEvent): Selection | null;
  onClick(selection: Selection | null, event: PointerEvent): Promise<void>;
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
