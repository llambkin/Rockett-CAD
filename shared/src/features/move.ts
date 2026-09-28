import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("move", "Move", (f) => refsAt("body", "/bodies", f.bodies));
