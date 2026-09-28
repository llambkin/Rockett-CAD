import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("loft", "Loft", (f) => [
  ...f.sections.map((section, i) =>
    section.profileId
      ? refAt("profile", `/sections/${i}`, section)
      : refAt("sketch", `/sections/${i}/sketchId`, section.sketchId),
  ),
  ...refsAt("body", "/targets", f.targets),
]);
