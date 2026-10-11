import { randomUUID } from "node:crypto";
import {
  bodyMadeBy,
  featureInputs,
  featureSpec,
  type CadDocument,
  type EvaluateResult,
  type Feature,
  type Health,
  type Placement,
} from "@rockett/shared";
import { build } from "../build.js";
import { enabledPluginClosures } from "../modules/thirdParty.js";
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
  evaluation?: Pick<EvaluateResult, "bodies" | "featureStatuses">;
}

const uncommitted = randomUUID();

const readsEverySketch = (f: Feature) =>
  f.type === "move" ||
  ((f.type === "extrude" || f.type === "revolve") &&
    (f.faces?.length ?? 0) > 0);

export function bodyDependencies({
  doc,
  bodyId,
  evaluation,
}: Pick<BodyInputs, "doc" | "bodyId" | "evaluation">): Feature[] {
  const statusOf = new Map(
    evaluation?.featureStatuses.map((s) => [s.featureId, s]),
  );
  const live = doc.features.slice(0, doc.timelinePosition);
  const inputs = live.map(featureInputs);
  const touched = live.map((f, i) => {
    const status = statusOf.get(f.id);
    return [
      ...inputs[i]!.bodies,
      ...(status?.bodyId ? [status.bodyId] : []),
      ...(status?.targets ?? []),
      ...Object.keys(status?.modified ?? {}),
    ];
  });
  const named = [
    ...new Set([
      ...(evaluation?.bodies.map((b) => b.bodyId) ?? []),
      ...touched.flat(),
    ]),
  ];
  const sketchAt = new Map(
    live.flatMap((g, i) => (g.type === "sketch" ? [[g.id, i] as const] : [])),
  );
  const bodies = new Set<string>();
  const want = (id: string) => {
    bodies.add(id);
    const whole = id.replace(/:\d+$/, "");
    if (whole !== id) want(whole);
  };
  want(bodyId);
  const features = new Set<string>();
  const carries = (i: number) =>
    [...features].some((id) => (sketchAt.get(id) ?? i) < i);
  let everything = false;
  const kept: Feature[] = [];
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i]!;
    const spec = featureSpec(f.type);
    const reach = [...touched[i]!, ...named.filter((b) => bodyMadeBy(f.id, b))];
    const opaque =
      !spec ||
      f.type.includes(".") ||
      (spec.producesGeometry && reach.length === 0);
    const separate =
      !everything &&
      !opaque &&
      statusOf.get(f.id)?.status === "ok" &&
      !features.has(f.id) &&
      !(f.type === "move" && carries(i)) &&
      ![...bodies].some((b) => bodyMadeBy(f.id, b)) &&
      !reach.some((b) => bodies.has(b));
    if (separate) continue;
    kept.push(f);
    everything ||= opaque;
    for (const b of reach) want(b);
    for (const id of inputs[i]!.features) features.add(id);
    if (readsEverySketch(f))
      for (const [id, at] of sketchAt) if (at < i) features.add(id);
  }
  return kept.toReversed();
}

export function bodyFingerprint(
  inputs: BodyInputs,
  features = bodyDependencies(inputs),
): string {
  const { doc, bodyId, sources, placement, selection, camVersion, kernel } =
    inputs;
  if (!kernel)
    throw new Error(
      "kernel version unknown: pass the version the loaded kernel reports before fingerprinting a CAM body",
    );
  const source = (hash: string) => {
    const bytes = sources.get(hash);
    return bytes ? sha256(bytes) : null;
  };
  const { version, commit } = build();
  const plugins = enabledPluginClosures();
  return sha256(
    JSON.stringify({
      features: features.map((feature) => featureKey(feature, doc, sources)),
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
      ...(plugins.length > 0 && { plugins }),
    }),
  );
}
