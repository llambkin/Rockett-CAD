import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("chamfer", "Chamfer", (f) => [
  ...refsAt("edge", "/edges", f.edges),
  ...refsAt("face", "/faces", f.faces),
  ...refsAt("feature", "/features", f.features),
]);
