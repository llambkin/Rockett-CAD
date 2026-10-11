import { BOUNDARY_NOT_COPIED, type PlaneRef } from "@rockett/shared";
import { ApiError } from "../api";
import { confirm } from "../components/ConfirmPanel";
import { isPlanarFace } from "./featureCommand";
import { useStore, type Selection } from "../store";
import { alignCameraToActiveSketch, type ViewportRef } from "../viewportRef";
import { exitActive, type ActiveCommand } from "./active";
import { chordText } from "./keymap";

function planeFor(selection: Selection | null): PlaneRef | undefined {
  if (selection?.kind === "plane") return selection.ref;
  if (
    selection?.kind === "face" &&
    isPlanarFace(selection, useStore.getState())
  )
    return { kind: "face", face: selection };
}

export async function sketchOnPlane(plane: PlaneRef) {
  const s = useStore.getState();
  try {
    await s.startSketchOnPlane(plane);
  } catch (e) {
    if (!(e instanceof ApiError && e.detail === BOUNDARY_NOT_COPIED)) throw e;
    s.setError(null);
    if (await confirm(e.message, undefined, "Create empty sketch"))
      await s.startSketchOnPlane(plane, "empty");
  }
}

async function pick(selection: Selection | null, viewport?: ViewportRef) {
  const s = useStore.getState();
  if (s.active?.id !== "design.sketch.create" || s.busy) return;
  const plane = planeFor(selection);
  if (!plane) return;
  await sketchOnPlane(plane);
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
  get banner() {
    return `Select a plane or planar face for the sketch${chordText(
      "design.cancel",
      (chord) => ` (${chord} to cancel)`,
    )}`;
  },
  keyContext: "design.sketch.create",
} satisfies ActiveCommand;
