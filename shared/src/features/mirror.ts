import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("mirror", "Mirror", (f) => [
  ...refsAt("body", "/bodies", f.bodies),
  refAt("plane", "/plane", f.plane),
]);
