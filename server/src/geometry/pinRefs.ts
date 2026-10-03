import { pinTargets, unsignedRefs, type CadDocument } from "@rockett/shared";
import type { DocumentEngine } from "./engine.js";
import type { Sources } from "./importers.js";
import { signRefs } from "./signature.js";

export function pinRefs(
  doc: CadDocument,
  engine: DocumentEngine,
  sources: Sources,
): CadDocument {
  const { featureStatuses } = engine.evaluate(
    doc,
    doc.features.length,
    sources,
  );
  const pinned = structuredClone(doc);
  pinned.features.forEach((feature, index) => {
    pinTargets(feature, featureStatuses[index]!.targets);
    const missing = unsignedRefs(feature);
    if (missing.length)
      signRefs(engine.stateAt(doc, index, sources).bodies, missing);
  });
  return pinned;
}
