import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("chamfer", "Chamfer", (f) =>
  refsAt("edge", "/edges", f.edges),
);
