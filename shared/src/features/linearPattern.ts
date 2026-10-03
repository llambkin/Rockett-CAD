import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("linearPattern", "LinearPattern", (f) => [
  ...refsAt("body", "/bodies", f.bodies),
  ...(f.direction.kind === "edge"
    ? [refAt("edge", "/direction/edge", f.direction.edge)]
    : []),
]);
