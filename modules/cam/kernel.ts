import features from "./src/kernel/features.js";
import generate from "./src/kernel/generate.js";
import holes from "./src/kernel/holes.js";
import regions from "./src/kernel/regions.js";
import surfaceMesh from "./src/kernel/surfaceMesh.js";

export default {
  ...regions,
  ...generate,
  ...surfaceMesh,
  ...holes,
  ...features,
};
