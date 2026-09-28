import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("offsetFace", "OffsetFace", (f) =>
  refsAt("face", "/faces", f.faces),
);
