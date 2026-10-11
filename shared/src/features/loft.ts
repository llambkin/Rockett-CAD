import { refAt, registerCoreSpec, toolTargetRefs } from "../featureSpec.js";

registerCoreSpec("loft", "Loft", (f) => [
  ...f.sections.map((section, i) =>
    "kind" in section
      ? refAt("face", `/sections/${i}`, section)
      : section.profileId
        ? refAt("profile", `/sections/${i}`, section)
        : refAt("sketch", `/sections/${i}/sketchId`, section.sketchId),
  ),
  ...toolTargetRefs(f),
]);
