import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("revolve", "Revolve", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  ...refsAt("face", "/faces", f.faces),
  refAt("axis", "/axis", f.axis),
  ...refsAt("body", "/targets", f.targets),
]);
