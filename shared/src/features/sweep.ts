import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("sweep", "Sweep", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  refAt("sketch", "/pathSketchId", f.pathSketchId),
  ...refsAt("body", "/targets", f.targets),
]);
