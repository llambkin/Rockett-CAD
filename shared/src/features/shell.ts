import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("shell", "Shell", (f) => [
  ...refsAt("face", "/openFaces", f.openFaces),
  ...(f.body === undefined ? [] : [refAt("body", "/body", f.body)]),
]);
