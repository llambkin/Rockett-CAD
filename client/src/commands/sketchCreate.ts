import type { PlaneRef } from "@rockett/shared";
import { isPlanarFace } from "./featureCommand";
import { useStore, type Selection } from "../store";
import { alignCameraToActiveSketch, type ViewportRef } from "../viewportRef";
import { exitActive, type ActiveCommand } from "./active";

function planeFor(selection: Selection | null): PlaneRef | undefined {
  if (selection?.kind === "plane") return selection.ref;
  if (
    selection?.kind === "face" &&
    isPlanarFace(selection, useStore.getState())
  )
    return { kind: "face", face: selection };
}

async function pick(selection: Selection | null, viewport?: ViewportRef) {
  const s = useStore.getState();
  if (s.active?.id !== "design.sketch.create" || s.busy) return;
  const plane = planeFor(selection);
  if (!plane) return;
  await s.startSketchOnPlane(plane);
  if (useStore.getState().active?.id === "design.sketch.create")
    sketchCreateCommand.exit();
  if (viewport) alignCameraToActiveSketch(viewport);
}

export const sketchCreateCommand = {
  async enter(viewport?: ViewportRef) {
    const selection = useStore.getState().selection;
    exitActive();
    useStore.getState().clearActive();
    useStore.setState({ active: { id: "design.sketch.create" }, hover: null });
    const selected =
      selection.find((s) => s.kind === "plane") ??
      selection.find((s) => planeFor(s));
    if (selected) await pick(selected, viewport);
  },
  exit() {
    useStore.setState({ active: null, hover: null });
  },
  pickFilter: () => [
    "design.originPlane",
    "design.constructionPlane",
    "design.face",
  ],
  onHover: (selection) => (planeFor(selection) ? selection : null),
  onClick: (selection, _event, viewport) => pick(selection, viewport),
  onContextMenu() {},
  hint: "Select a plane or planar face to sketch on",
  banner: "Select a plane or planar face for the sketch (Esc to cancel)",
  keyContext: "design.sketch.create",
} satisfies ActiveCommand;
