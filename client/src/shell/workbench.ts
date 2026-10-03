import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createRegistry } from "@rockett/shared";
import { exitActive } from "../commands/active";
import { useStore, type Selection } from "../store";

export interface Workbench {
  id: string;
  label: string;
  panels: readonly string[];
  selectionKinds: readonly Selection["kind"][];
}

const workbenches = createRegistry<Workbench>("workbench", (w) => w.id);
export const registerWorkbench = workbenches.register;
export const useWorkbench = create(() => ({
  current: "design",
  switching: false,
}));
export const useWorkbenches = () =>
  useSyncExternalStore(
    workbenches.subscribe,
    workbenches.snapshot,
    workbenches.snapshot,
  );

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
    "inspect.measure",
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
