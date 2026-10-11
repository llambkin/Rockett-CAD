import type { ExportRequest } from "@rockett/shared";
import { api, saveDownload } from "../api";
import { registerCommand, type CommandContext } from "./registry";
import { isPlanarFace } from "./featureCommand";
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
    .filter((entry) => !hidden.has(entry.bodyId) && !entry.reference)
    .map((entry) => entry.bodyId);
}

export async function downloadExport(
  projectId: string,
  request: ExportRequest,
  onClose: () => void,
  fileName?: string,
) {
  const { active, setError } = useStore.getState();
  try {
    const file = await api.exportModel(projectId, request);
    saveDownload({ ...file, fileName: fileName ?? file.fileName });
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
    const selection = s.selection.filter((pick) => body(pick));
    exitActive();
    s.clearActive();
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

type DxfTarget = { id: string } | { sel: Selection };

function dxfExport(ctx: CommandContext & { target?: DxfTarget }) {
  const { target } = ctx;
  if (!target) return undefined;
  if ("sel" in target) {
    const { sel } = target;
    if (sel.kind !== "face" || !isPlanarFace(sel, ctx)) return undefined;
    const { bodyId, faceName } = sel;
    const found = ctx.evaluation?.bodies.find((b) => b.bodyId === bodyId);
    const request: ExportRequest = {
      format: "dxf",
      bodyIds: [bodyId],
      face: { kind: "face", bodyId, faceName },
    };
    return { name: found?.name ?? bodyId, request };
  }
  const sketch = ctx.document?.features.find(
    (f) => f.id === target.id && f.type === "sketch",
  );
  const evaluated = ctx.evaluation?.sketches.some(
    (e) => e.featureId === target.id,
  );
  if (!sketch || !evaluated) return undefined;
  const request: ExportRequest = {
    format: "dxf",
    bodyIds: [],
    sketchId: sketch.id,
  };
  return { name: sketch.name, request };
}

export const canExportDxf = (ctx: CommandContext & { target?: DxfTarget }) =>
  dxfExport(ctx) !== undefined;

registerCommand({
  id: "design.menu.exportDxf",
  label: "Export DXF",
  when: (ctx) => "target" in ctx,
  enabled: (ctx) =>
    canExportDxf(ctx)
      ? true
      : "Export DXF needs an evaluated sketch or a planar face",
  run(ctx) {
    const dxf = dxfExport(ctx);
    if (!dxf || !ctx.document) return;
    return downloadExport(
      ctx.document.id,
      dxf.request,
      () => {},
      `${dxf.name}.dxf`,
    );
  },
});
