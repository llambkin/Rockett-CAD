import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("shell", "Shell", (f) =>
  refsAt("face", "/openFaces", f.openFaces),
);
