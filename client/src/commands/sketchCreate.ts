import type { PlaneRef } from "@rockett/shared";
import { isPlanarFace } from "../dialogPicks";
import { useStore, type Selection } from "../store";
import { alignCameraToActiveSketch } from "../viewportRef";
import { exitActive, type ActiveCommand } from "./active";

function planeFor(selection: Selection | null): PlaneRef | undefined {
  if (selection?.kind === "plane") return selection.ref;
  if (
    selection?.kind === "face" &&
    isPlanarFace(selection, useStore.getState())
  )
    return { kind: "face", face: selection };
}

async function pick(selection: Selection | null) {
  const s = useStore.getState();
  if (s.active?.id !== "design.sketch.create" || s.busy) return;
  const plane = planeFor(selection);
  if (!plane) return;
  await s.startSketchOnPlane(plane);
  if (useStore.getState().active?.id === "design.sketch.create")
    sketchCreateCommand.exit();
  alignCameraToActiveSketch();
}

export const sketchCreateCommand: ActiveCommand = {
  async enter() {
    const selection = useStore.getState().selection;
    exitActive();
    useStore.getState().setMode({ name: "idle" });
    useStore.setState({ active: { id: "design.sketch.create" }, hover: null });
    const selected =
      selection.find((s) => s.kind === "plane") ??
      selection.find((s) => planeFor(s));
    if (selected) await pick(selected);
  },
  exit() {
    useStore.setState({ active: null, hover: null });
  },
  pickFilter: ["design.originPlane", "design.constructionPlane", "design.face"],
  onHover: (selection) => (planeFor(selection) ? selection : null),
  onClick: pick,
  onContextMenu() {},
  hint: "Select a plane or planar face to sketch on",
  banner: "Select a plane or planar face for the sketch (Esc to cancel)",
  keyContext: "design.sketch.create",
};
