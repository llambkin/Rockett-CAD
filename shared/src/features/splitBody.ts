import { refAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("splitBody", "SplitBody", (f) => [
  refAt("body", "/body", f.body),
  refAt("plane", "/tool", f.tool),
]);
