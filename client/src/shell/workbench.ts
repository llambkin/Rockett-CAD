import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { Workbench } from "@rockett/plugin-api";
import { createRegistry } from "@rockett/shared";
import { exitActive } from "../commands/active";
import { useStore } from "../store";

const workbenches = createRegistry<Workbench>("workbench", (w) => w.id);
export const registerWorkbench = workbenches.register;
export const useWorkbench = create(() => ({
  current: "design",
  switching: false,
}));
workbenches.subscribe(() => {
  if (!workbenches.get(useWorkbench.getState().current))
    useWorkbench.setState({ current: "design" });
});
export const useWorkbenches = () =>
  useSyncExternalStore(
    workbenches.subscribe,
    workbenches.snapshot,
    workbenches.snapshot,
  );

export function useCurrentWorkbench(): Workbench | undefined {
  const current = useWorkbench((s) => s.current);
  return useWorkbenches().find((w) => w.id === current);
}

export async function switchWorkbench(id: string): Promise<void> {
  const { current, switching } = useWorkbench.getState();
  if (id === current || switching || useStore.getState().busy) return;
  const target = workbenches.get(id);
  if (!target) throw new Error(`Unknown workbench: ${id}`);
  const projectId = useStore.getState().projectId;
  useWorkbench.setState({ switching: true });
  try {
    exitActive();
    if (useStore.getState().active?.id === "design.sketch") {
      await useStore.getState().finishSketch();
      if (useStore.getState().active?.id === "design.sketch") return;
    }
    const state = useStore.getState();
    if (state.projectId !== projectId || workbenches.get(id) !== target) return;
    state.setSelection([]);
    state.setHover(null);
    useWorkbench.setState({ current: id });
  } finally {
    useWorkbench.setState({ switching: false });
  }
}

registerWorkbench({
  id: "design",
  label: "Design",
  panels: [
    "design.export",
    "design.feature",
    "sketch.offset",
    "design.help",
    "design.history",
  ],
  selectionKinds: [
    "body",
    "face",
    "edge",
    "vertex",
    "plane",
    "axis",
    "profile",
    "sketch",
    "sketchEntity",
    "sketchPoint",
  ],
});
