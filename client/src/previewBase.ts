import type {
  BodyPayload,
  CadDocument,
  EvaluateResult,
  ParameterBinding,
  ProjectView,
} from "@rockett/shared";
import { create } from "zustand";
import { api } from "./api";
import {
  previewTints,
  type PreviewGhost,
  type PreviewTint,
} from "./livePreview";
import type { Active } from "./commands/active";

type Base = {
  fid: string;
  bodies: BodyPayload[];
  loaded: boolean;
  after?: BodyPayload[] | undefined;
} | null;

const held = create<{ base: Base }>(() => ({ base: null }));
const hold = (base: Base) => held.setState({ base });
const current = () => held.getState().base;
let copied: { shown: ParameterBinding[]; links: ParameterBinding[] } | null =
  null;

export const usePreviewBase = () => held((s) => s.base);

export function dropBase(): void {
  hold(null);
}

export function holdBase(fid: string, evaluation: EvaluateResult | null) {
  if (!current())
    hold({ fid, bodies: evaluation?.bodies ?? [], loaded: false });
}

export function committedLinks(
  doc: Pick<CadDocument, "parameterBindings">,
): ParameterBinding[] {
  const shown = doc.parameterBindings;
  return shown === copied?.shown ? copied.links : shown;
}

export function previewCopy(
  doc: CadDocument,
  from: CadDocument | null,
): CadDocument {
  const shown = doc.parameterBindings;
  copied = { shown, links: from ? committedLinks(from) : shown };
  return doc;
}

export function landAfter(fid: string, after: BodyPayload[] | undefined) {
  const base = current();
  if (base?.fid === fid) hold({ ...base, after });
}

function previewAfter(s: { evaluation: EvaluateResult | null }): BodyPayload[] {
  return current()?.after ?? s.evaluation?.bodies ?? [];
}

function previewBodyTints(s: {
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
}): Map<string, PreviewTint> {
  const base = current();
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

export function previewBodies(
  s: { active: Active | null; evaluation: EvaluateResult | null },
  base = current(),
): BodyPayload[] {
  return s.active?.id === "design.feature" && base
    ? base.bodies
    : (s.evaluation?.bodies ?? []);
}

export function baseBodies(s: {
  active: Active | null;
  evaluation: EvaluateResult | null;
}): BodyPayload[] {
  const editing =
    s.active?.id === "design.feature" && s.active.state.editFeatureId;
  return editing && !current()?.loaded ? [] : previewBodies(s);
}

export function previewScene(s: {
  active: Active | null;
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
    active: Active | null;
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
    const { active, projectId } = read();
    if (
      active?.id !== "design.feature" ||
      active.state.editFeatureId !== fid ||
      projectId !== document.id
    )
      return false;
    const base = current();
    const landed = base?.fid === fid ? base.after : undefined;
    hold({ fid, bodies, loaded: true, after: landed ?? after });
    return true;
  } catch {
    return false;
  }
}
