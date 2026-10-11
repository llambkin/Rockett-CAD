import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("combine", "Combine", (f) => [
  refAt("body", "/targetBody", f.targetBody),
  ...refsAt("body", "/toolBodies", f.toolBodies),
]);
