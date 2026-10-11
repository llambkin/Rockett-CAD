import type {
  Feature,
  ImportMeshFeature,
  ImportStepFeature,
} from "@rockett/shared";
import { ImportPanel } from "../components/ImportPanel";
import {
  registerFeatureUI,
  type FeatureUI,
  type InputParams,
} from "./registry";

type ImportParams = InputParams<Pick<Feature, "id" | "name">>;

const imported = {
  initialParams: {},
  icon: "⇩",
  group: "insert",
  picks: [],
  Panel: ImportPanel,
  prefill: (f: Feature) => ({
    params: { id: f.id, name: f.name },
    selection: [],
  }),
};

const importStep: FeatureUI<ImportStepFeature, ImportParams> = {
  ...imported,
  type: "importStep",
  title: "Imported STEP",
};

const importMesh: FeatureUI<ImportMeshFeature, ImportParams> = {
  ...imported,
  type: "importMesh",
  title: "Imported mesh",
};

registerFeatureUI(importStep);
registerFeatureUI(importMesh);
