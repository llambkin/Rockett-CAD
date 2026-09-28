import type { SketchFeature } from "@rockett/shared";
import { useStore } from "../store";
import { alignCameraToActiveSketch } from "../viewportRef";
import { registerFeatureUI, type FeatureUI } from "./registry";

const sketch: FeatureUI<SketchFeature> = {
  type: "sketch",
  icon: "✏",
  title: "Sketch",
  group: "create",
  picks: [],
  open: async (f) => {
    void useStore.getState().editSketch(f.id).then(alignCameraToActiveSketch);
  },
};

registerFeatureUI(sketch);
