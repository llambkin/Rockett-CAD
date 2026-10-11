import { useEffect } from "react";
import type {
  BodyPayload,
  NamingCandidate,
  NamingMapping,
  NamingMesh,
} from "@rockett/shared";
import { selectionKey, useStore, type Selection } from "../store";
import { usePreviewBase } from "../previewBase";
import { meshOf, useMeshVersion } from "../three/meshes";

export const mappingKey = (m: NamingMapping) => `${m.featureId}\n${m.path}`;

const sameBox = (a: BodyPayload["bbox"], b: BodyPayload["bbox"]) =>
  JSON.stringify(a) === JSON.stringify(b);

function shownIn(body: BodyPayload, mesh: NamingMesh): Selection | null {
  const { bodyId } = body;
  const shape = meshOf(body);
  if (!shape) return null;
  if (mesh.kind === "edge") {
    const line = JSON.stringify(mesh.polyline);
    const edge = shape.edges.find((e) => JSON.stringify(e.polyline) === line);
    return edge ? { kind: "edge", bodyId, edgeName: edge.name } : null;
  }
  if (mesh.kind === "body")
    return shape.indices.length === mesh.count
      ? { kind: "body", bodyId }
      : null;
  const face = shape.faces.find(
    (f) => f.start === mesh.start && f.count === mesh.count,
  );
  return face ? { kind: "face", bodyId, faceName: face.name } : null;
}

function shownAt(
  bodies: BodyPayload[],
  { mesh }: NamingCandidate,
): Selection | null {
  if (!mesh) return null;
  for (const body of bodies)
    if (sameBox(body.bbox, mesh.bbox)) {
      const shown = shownIn(body, mesh);
      if (shown) return shown;
    }
  return null;
}

const hits = (shown: Selection | null, pick: Selection) =>
  !!shown &&
  (shown.kind === "body"
    ? "bodyId" in pick && pick.bodyId === shown.bodyId
    : selectionKey(shown) === selectionKey(pick));

export function useNamingCandidates(
  mappings: NamingMapping[],
  picking: string | null,
  onPick: (m: NamingMapping, to: NamingCandidate) => void,
) {
  const active = useStore((s) => s.active);
  const evaluation = useStore((s) => s.evaluation);
  const here =
    active?.id === "design.feature" ? active.state.editFeatureId : null;
  const base = usePreviewBase();
  useMeshVersion();
  const bodies =
    here === null
      ? (evaluation?.bodies ?? [])
      : base?.loaded && base.fid === here
        ? base.bodies
        : [];
  const shown = (m: NamingMapping, c: NamingCandidate) =>
    m.featureId === here ? shownAt(bodies, c) : null;
  useEffect(() => {
    const m = mappings.find((other) => mappingKey(other) === picking);
    if (!m) return;
    return useStore.subscribe((s, prev) => {
      const added = s.selection.find((x) => !prev.selection.includes(x));
      const to =
        added &&
        [...m.candidates, ...m.suggestions].find((c) =>
          hits(shown(m, c), added),
        );
      if (to) onPick(m, to);
    });
  });
  return { here, shown };
}
