import {
  refAt,
  refsAt,
  registerCoreSpec,
  toolTargetRefs,
} from "../featureSpec.js";

registerCoreSpec("sweep", "Sweep", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  refAt("sketch", "/pathSketchId", f.pathSketchId),
  ...toolTargetRefs(f),
]);
