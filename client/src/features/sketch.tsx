import { openInDialog } from "../commands/featureCommand";
import type { SketchFeature } from "@rockett/shared";
import { useStore } from "../store";
import { alignCameraToActiveSketch } from "../viewportRef";
import { DraggablePanel } from "../components/DraggablePanel";
import { RefRepair } from "../components/RefRepair";
import { DialogFooter } from "../components/form/DialogFooter";
import {
  registerFeatureUI,
  type FeatureUI,
  type InputParams,
  featureUI,
  type FeaturePanelProps,
} from "./registry";

const sketch = {
  type: "sketch",
  icon: "✏",
  title: "Sketch",
  group: "create",
  picks: [],
  initialParams: {},
  prefill: () => ({ params: {}, selection: [] }),
  Panel: SketchRepair,
  open: async (f, viewport): Promise<void> => {
    const s = useStore.getState();
    if (
      s.evaluation?.featureStatuses.find((st) => st.featureId === f.id)?.refs
        ?.length
    ) {
      const ui = featureUI(f.type);
      if (ui) return openInDialog(ui, f);
      return;
    }
    await s.editSketch(f.id);
    if (viewport) alignCameraToActiveSketch(viewport);
  },
} satisfies FeatureUI<SketchFeature, InputParams<{}>>;

registerFeatureUI(sketch);

function SketchRepair({ onClose }: FeaturePanelProps) {
  return (
    <DraggablePanel id="sketch.repair" title="Repair sketch references">
      <div className="dialog-body">
        <RefRepair />
      </div>
      <DialogFooter onOk={onClose} onCancel={onClose} escapeAnywhere />
    </DraggablePanel>
  );
}
