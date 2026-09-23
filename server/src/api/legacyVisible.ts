import type {
  CadDocument,
  EvaluateResult,
  Feature,
  ProjectView,
} from "@rockett/shared";
import type { Visibility } from "../store/migrations.js";

export function takeVisible(feature: Partial<Feature>, id: string): Visibility {
  const { visible } = feature as { visible?: boolean };
  delete (feature as { visible?: boolean }).visible;
  return {
    bodies: {},
    features: visible === undefined ? {} : { [id]: visible },
  };
}

export function withVisible(doc: CadDocument, view: ProjectView): CadDocument {
  const hidden = new Set(view.hidden.features);
  return {
    ...doc,
    features: doc.features.map((f) =>
      f.type === "sketch" || f.type === "referenceImage"
        ? { ...f, visible: !hidden.has(f.id) }
        : f,
    ),
  };
}

export function withVisibleBodies(
  evaluation: EvaluateResult,
  view: ProjectView,
): EvaluateResult {
  const hidden = new Set(view.hidden.bodies);
  return {
    ...evaluation,
    bodies: evaluation.bodies.map((b) => ({
      ...b,
      visible: !hidden.has(b.bodyId),
    })),
  };
}
