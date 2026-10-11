import {
  Component,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Panel } from "@rockett/plugin-api";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createRegistry } from "@rockett/shared";
import { activeCommand } from "../commands/active";
import type { CommandContext } from "../commands/registry";
import { useStore } from "../store";
import { ExportPanel } from "../components/ExportPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { ShortcutSheet } from "../components/ShortcutSheet";
import { DraggablePanel } from "../components/DraggablePanel";
import { FeatureDialog } from "../components/FeatureDialog";
import { SketchOffset } from "../components/SketchOffsetPanel";
import { SketchMove } from "../components/SketchMovePanel";

export type PanelDef = Panel<CommandContext>;

const panels = createRegistry<PanelDef>("panel", (p) => p.id);
const opened = create<{ open: readonly string[] }>(() => ({ open: [] }));

export const registerPanel = panels.register;
export const HELP_PANEL = "design.help";
export const HISTORY_PANEL = "design.history";

function showPanel(id: string, show: boolean): void {
  opened.setState(({ open }) => ({
    open: [...open.filter((o) => o !== id), ...(show ? [id] : [])],
  }));
}

export const openPanel = (id: string) => showPanel(id, true);
export const closePanel = (id: string) => showPanel(id, false);
export const togglePanel = (id: string) =>
  showPanel(id, !opened.getState().open.includes(id));

export const usePanelOpen = (id: string) => opened((s) => s.open.includes(id));

export class PanelBoundary extends Component<
  { panel: Pick<PanelDef, "id" | "title">; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    const { panel, children } = this.props;
    if (!this.state.error) return children;
    return (
      <DraggablePanel id={panel.id} title={panel.title}>
        <div className="dialog-body">
          <div className="error-banner" role="alert">
            {panel.id}: {this.state.error.message}
          </div>
        </div>
      </DraggablePanel>
    );
  }
}

export function Panels() {
  const all = useSyncExternalStore(
    panels.subscribe,
    panels.snapshot,
    panels.snapshot,
  );
  const open = opened((s) => s.open);
  const shown = useStore(useShallow((s) => all.filter((p) => p.when(s, open))));
  useEffect(() => () => opened.setState({ open: [] }), []);
  return shown.map((panel) => (
    <PanelBoundary key={panel.id} panel={panel}>
      <panel.component />
    </PanelBoundary>
  ));
}

registerPanel({
  id: "design.export",
  title: "Export for 3D printing",
  when: (s) => activeCommand(s)?.panel === "design.export",
  component: () => (
    <ExportPanel onClose={() => useStore.getState().clearActive()} />
  ),
});
registerPanel({
  id: "design.feature",
  title: "Feature",
  when: (s) => activeCommand(s)?.panel === "design.feature",
  component: FeatureDialog,
});
registerPanel({
  id: "sketch.offset",
  title: "Offset sketch",
  when: (s) =>
    s.active?.id === "design.sketch" && s.active.state.tool === "offset",
  component: SketchOffset,
});
registerPanel({
  id: "sketch.moveCopy",
  title: "Move/Copy",
  when: (s) =>
    s.active?.id === "design.sketch" &&
    s.active.state.tool === "select" &&
    s.active.state.moveCopy,
  component: SketchMove,
});
registerPanel({
  id: HELP_PANEL,
  title: "Keyboard & mouse controls",
  when: (_, open) => open.includes(HELP_PANEL),
  component: () => <ShortcutSheet onClose={() => togglePanel(HELP_PANEL)} />,
});
registerPanel({
  id: HISTORY_PANEL,
  title: "History",
  when: (_, open) => open.includes(HISTORY_PANEL),
  component: () => <HistoryPanel onClose={() => togglePanel(HISTORY_PANEL)} />,
});
