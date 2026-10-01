import type { Feature, PlaneRef } from "@rockett/shared";
import type { ViewportRef } from "../viewportRef";
import { runCommand } from "../commands/registry";
import { useStore } from "../store";
import { setFeaturesVisible } from "../treeSelection";
import { openFeatureEditor } from "./Timeline";
import type { MenuItem } from "./ContextMenu";

export const sketchOn = (ref: PlaneRef, viewport: ViewportRef) => {
  useStore.getState().setSelection([{ kind: "plane", ref, label: "Plane" }]);
  void runCommand("design.sketch.create", viewport);
};
export const planeMenu = (ref: PlaneRef, viewport: ViewportRef): MenuItem[] =>
  useStore.getState().active?.id !== "design.sketch"
    ? [{ label: "Create sketch", action: () => sketchOn(ref, viewport) }]
    : [];
export const deleteItem = (id: string): MenuItem => ({
  label: "Delete",
  danger: true,
  action: () => void useStore.getState().deleteFeature(id),
});
export const toggleFeature = (f: Feature) =>
  void setFeaturesVisible(
    [f.id],
    useStore.getState().view.hidden.features.includes(f.id),
  );

export const constructionMenu = (
  f: Feature,
  viewport: ViewportRef,
): MenuItem[] => [
  ...planeMenu({ kind: "construction", featureId: f.id }, viewport),
  { label: "Edit", action: () => void openFeatureEditor(f, viewport) },
  { label: "Show / Hide", action: () => toggleFeature(f) },
  deleteItem(f.id),
];

export const canvasMenu = (f: Feature, viewport: ViewportRef): MenuItem[] => [
  { label: "Edit", action: () => void openFeatureEditor(f, viewport) },
  { label: "Show / Hide", action: () => toggleFeature(f) },
  deleteItem(f.id),
];
