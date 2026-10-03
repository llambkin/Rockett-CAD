import { refAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec(
  "referenceImage",
  "Canvas",
  (f) => [refAt("plane", "/plane", f.plane)],
  {
    producesGeometry: false,
  },
);
