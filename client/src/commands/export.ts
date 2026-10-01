import type { ExportRequest } from "@rockett/shared";
import { api, saveDownload } from "../api";
import type { CommandContext } from "./registry";
import { selectionBeforeCommand } from "../selection/kinds";
import { useStore, type Selection } from "../store";
import { exitActive, type ActiveCommand } from "./active";

const body = (selection: Selection | null) =>
  selection?.kind === "body" ? selection : null;

function selectBodies(selection: readonly Selection[]) {
  const s = useStore.getState();
  if (s.active?.id !== "design.export" || s.busy) return;
  for (const pick of selection) if (body(pick)) s.toggleSelection(pick, true);
}

export function exportBodyIds(s: CommandContext): string[] {
  const selected = s.selection.flatMap((pick) =>
    pick.kind === "body" ? [pick.bodyId] : [],
  );
  if (selected.length) return selected;
  const hidden = new Set(s.view.hidden.bodies);
  return (s.evaluation?.bodies ?? [])
    .filter((body) => !hidden.has(body.bodyId))
    .map((body) => body.bodyId);
}

export async function downloadExport(
  projectId: string,
  request: ExportRequest,
  onClose: () => void,
) {
  const { active, setError } = useStore.getState();
  try {
    saveDownload(await api.exportModel(projectId, request));
    if (useStore.getState().active === active) onClose();
  } catch (e) {
    if (useStore.getState().active === active)
      setError(e instanceof Error ? e.message : String(e));
  }
}

export const exportCommand: ActiveCommand = {
  enter() {
    const s = useStore.getState();
    const selectionBefore = selectionBeforeCommand(s);
    const selection = s.selection.filter((s) => body(s));
    exitActive();
    s.setMode({ name: "idle" });
    useStore.setState({
      active: { id: "design.export", state: { selectionBefore } },
      selection,
      hover: null,
    });
  },
  exit() {
    useStore.getState().cancelDialog();
  },
  pickFilter: () => ["design.body"],
  onHover: body,
  async onClick(selection) {
    selectBodies(selection ? [selection] : []);
  },
  onSelection: selectBodies,
  onContextMenu() {},
  hint: "",
  panel: "design.export",
  keyContext: "design.export",
};
