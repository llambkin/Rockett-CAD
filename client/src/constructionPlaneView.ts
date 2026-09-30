import type { CadDocument, EvaluateResult } from "@rockett/shared";
import type { CadViewport } from "./three/CadViewport";

export function syncConstructionPlanes(
  vp: CadViewport,
  doc: CadDocument | null,
  evaluation: EvaluateResult,
  hidden: ReadonlySet<string>,
) {
  const names = new Map<string, string>();
  const visible = new Set<string>();
  for (const f of doc?.features ?? []) {
    names.set(f.id, f.name);
    if (f.type === "constructionPlane" && !f.suppressed && !hidden.has(f.id))
      visible.add(f.id);
  }
  vp.syncConstructionPlanes(evaluation.planes, names, visible);
}
