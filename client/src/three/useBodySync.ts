import { useEffect, type RefObject } from "react";
import { extrudeGhosts } from "../extrudeReach";
import { previewScene, usePreviewBase } from "../previewBase";
import { useStore } from "../store";
import type { CadViewport } from "./CadViewport";
import { useMeshVersion } from "./meshes";

export function useBodySync(
  viewport: RefObject<CadViewport | null>,
  dialogOpen: boolean,
  editFeatureId: string | undefined,
) {
  const evaluation = useStore((s) => s.evaluation);
  const doc = useStore((s) => s.document);
  const hiddenBodies = useStore((s) => s.view.hidden.bodies);
  const held = usePreviewBase();
  const meshVersion = useMeshVersion();
  useEffect(() => {
    const vp = viewport.current;
    if (!vp || !evaluation) return;
    const scene = previewScene(useStore.getState());
    const id = useStore.getState().projectId ?? undefined;
    vp.syncBodies(scene.bodies, new Set(hiddenBodies), id);
    vp.setBodyTints(scene.tints);
    vp.setPreviewGhosts(extrudeGhosts(scene.ghosts));
  }, [
    viewport,
    evaluation,
    doc,
    hiddenBodies,
    dialogOpen,
    editFeatureId,
    held,
    meshVersion,
  ]);
  return meshVersion;
}
