import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("circularPattern", "CircularPattern", (f) => [
  ...refsAt("body", "/bodies", f.bodies),
  refAt("axis", "/axis", f.axis),
]);
