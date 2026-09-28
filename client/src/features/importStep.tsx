import type {
  Feature,
  ImportMeshFeature,
  ImportStepFeature,
} from "@rockett/shared";
import { ImportPanel } from "../components/ImportPanel";
import { registerFeatureUI, type FeatureUI } from "./registry";

const imported = {
  icon: "⇩",
  group: "insert",
  picks: [],
  Panel: ImportPanel,
  prefill: (f: Feature) => ({
    params: { id: f.id, name: f.name },
    selection: [],
  }),
};

const importStep: FeatureUI<ImportStepFeature> = {
  ...imported,
  type: "importStep",
  title: "Imported STEP",
};

const importMesh: FeatureUI<ImportMeshFeature> = {
  ...imported,
  type: "importMesh",
  title: "Imported mesh",
};

registerFeatureUI(importStep);
registerFeatureUI(importMesh);
