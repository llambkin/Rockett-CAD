import type { Feature, PlaneRef } from "@rockett/shared";
import type { ViewportRef } from "../viewportRef";
import { runCommand } from "../commands/registry";
import { useStore } from "../store";
import { setFeaturesVisible } from "../treeSelection";

export const sketchOn = (ref: PlaneRef, viewport: ViewportRef) => {
  useStore.getState().setSelection([{ kind: "plane", ref, label: "Plane" }]);
  void runCommand("design.sketch.create", viewport);
};
export const toggleFeature = (f: Feature) =>
  void setFeaturesVisible(
    [f.id],
    useStore.getState().view.hidden.features.includes(f.id),
  );
