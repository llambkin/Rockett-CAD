import type {
  CadDocument,
  SketchFeature,
  SketchPayload,
} from "@rockett/shared";
import { isProfileUsed, sketchUsage } from "./sketchUsage";
import type { SketchRenderInput } from "./three/sketchRender";

export interface SketchScene {
  document: CadDocument;
  sketches: SketchPayload[];
  hidden: readonly string[];
  editingId: string | null;
  draft: SketchFeature | null;
  showProfiles: boolean;
  peeked: string | null | undefined;
}

export function sketchRenderInputs(scene: SketchScene): SketchRenderInput[] {
  const usage = sketchUsage(scene.document, scene.sketches);
  const hidden = new Set(scene.hidden);
  const inputs: SketchRenderInput[] = [];
  for (const sk of scene.sketches) {
    if (sk.featureId === scene.editingId && scene.draft) {
      inputs.push({
        sketchId: sk.featureId,
        frame: sk.frame,
        entities: scene.draft.entities,
        showProfiles: true,
        active: true,
      });
      continue;
    }
    if (hidden.has(sk.featureId)) continue;
    const usedHere = new Set(
      sk.profiles
        .filter((p) => isProfileUsed(usage, sk.featureId, p.id))
        .map((p) => p.id),
    );
    inputs.push({
      sketchId: sk.featureId,
      frame: sk.frame,
      entities: sk.entities,
      showProfiles: scene.showProfiles,
      profiles: sk.profiles,
      usedProfileIds: usedHere,
      active: false,
      dim: usedHere.size > 0,
      lit: sk.featureId === scene.peeked,
    });
  }
  return inputs;
}
