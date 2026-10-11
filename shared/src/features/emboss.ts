import { refsAt, registerCoreSpec, toolTargetRefs } from "../featureSpec.js";

registerCoreSpec("emboss", "Emboss", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  ...toolTargetRefs(f),
]);
