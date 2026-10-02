import { randomUUID } from "node:crypto";
import type { CadDocument, Health, Placement } from "@rockett/shared";
import { build } from "../build.js";
import { sha256 } from "../store/jsonStore.js";
import { featureKey } from "./engine.js";
import type { Sources } from "./importers.js";

export interface BodyInputs {
  doc: CadDocument;
  bodyId: string;
  sources: Sources;
  placement: Placement;
  selection: readonly string[];
  camVersion: string;
  kernel: Health["kernelVersion"];
}

const uncommitted = randomUUID();

export function bodyFingerprint({
  doc,
  bodyId,
  sources,
  placement,
  selection,
  camVersion,
  kernel,
}: BodyInputs): string {
  if (!kernel)
    throw new Error(
      "kernel version unknown: pass the version the loaded kernel reports before fingerprinting a CAM body",
    );
  const features = doc.features.slice(0, doc.timelinePosition);
  const source = (hash: string) => {
    const bytes = sources.get(hash);
    return bytes ? sha256(bytes) : null;
  };
  const { version, commit } = build();
  return sha256(
    JSON.stringify({
      features: features.map(featureKey),
      sources: features.flatMap((f) =>
        f.type === "importStep" || f.type === "importMesh"
          ? [source(f.blob)]
          : [],
      ),
      namingVersion: doc.namingVersion,
      kernel,
      build: [version, commit ?? uncommitted],
      bodyId,
      placement,
      selection,
      camVersion,
    }),
  );
}
