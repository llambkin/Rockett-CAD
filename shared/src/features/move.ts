import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("move", "Move", (f) => [
  ...refsAt("body", "/bodies", f.bodies),
  refAt("axis", "/axis", f.axis),
]);
