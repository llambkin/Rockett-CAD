import type {
  BodyPayload,
  CadDocument,
  EvaluateResult,
  ProjectView,
} from "@rockett/shared";
import { api } from "./api";
import {
  previewTints,
  type PreviewGhost,
  type PreviewTint,
} from "./livePreview";
import type { Mode } from "./store";

let base: {
  fid: string;
  bodies: BodyPayload[];
  loaded: boolean;
  after?: BodyPayload[] | undefined;
} | null = null;

export function dropBase(): void {
  base = null;
}

export function holdBase(fid: string, evaluation: EvaluateResult | null) {
  base ??= { fid, bodies: evaluation?.bodies ?? [], loaded: false };
}

export function landAfter(fid: string, after: BodyPayload[] | undefined) {
  if (base?.fid === fid) base.after = after;
}

function previewAfter(s: { evaluation: EvaluateResult | null }): BodyPayload[] {
  return base?.after ?? s.evaluation?.bodies ?? [];
}

function previewBodyTints(s: {
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
}): Map<string, PreviewTint> {
  const feature = s.document?.features.find((f) => f.id === base?.fid);
  if (!base || !feature || feature.suppressed || !s.evaluation)
    return new Map();
  return previewTints(feature, base.bodies, previewAfter(s));
}

export async function bodiesAfter(
  document: CadDocument,
  fid: string,
): Promise<BodyPayload[] | undefined> {
  const index = document.features.findIndex((f) => f.id === fid);
  if (index < 0 || index + 1 >= document.timelinePosition) return undefined;
  return (await api.evaluate(document.id, index + 1)).bodies;
}

export function previewBodies(s: {
  mode: Mode;
  evaluation: EvaluateResult | null;
}): BodyPayload[] {
  return s.mode.name === "dialog" && base
    ? base.bodies
    : (s.evaluation?.bodies ?? []);
}

export function baseBodies(s: {
  mode: Mode;
  evaluation: EvaluateResult | null;
}): BodyPayload[] {
  const editing = s.mode.name === "dialog" && s.mode.editFeatureId;
  return editing && !base?.loaded ? [] : previewBodies(s);
}

export function previewScene(s: {
  mode: Mode;
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
  view: ProjectView;
}): {
  bodies: BodyPayload[];
  tints: Map<string, PreviewTint>;
  ghosts: PreviewGhost[];
} {
  const bodies = s.evaluation?.bodies ?? [];
  const tints = previewBodyTints(s);
  const shown = previewBodies(s);
  if (shown === bodies) return { bodies, tints, ghosts: [] };
  const hidden = new Set(s.view.hidden.bodies);
  return {
    bodies: shown,
    tints: new Map(),
    ghosts: previewAfter(s).flatMap((body) => {
      const tint = tints.get(body.bodyId);
      return tint && !hidden.has(body.bodyId) ? [{ body, ...tint }] : [];
    }),
  };
}

export async function loadPreviewBase(
  fid: string,
  read: () => {
    mode: Mode;
    document: CadDocument | null;
    projectId: string | null;
  },
): Promise<boolean> {
  const { document } = read();
  const index = document?.features.findIndex((f) => f.id === fid) ?? -1;
  if (!document || index < 0 || index >= document.timelinePosition)
    return false;
  try {
    const [{ bodies }, after] = await Promise.all([
      api.evaluate(document.id, index),
      bodiesAfter(document, fid),
    ]);
    const { mode, projectId } = read();
    if (
      mode.name !== "dialog" ||
      mode.editFeatureId !== fid ||
      projectId !== document.id
    )
      return false;
    const landed = base?.fid === fid ? base.after : undefined;
    base = { fid, bodies, loaded: true, after: landed ?? after };
    return true;
  } catch {
    return false;
  }
}
