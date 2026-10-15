/**
 * Central client state (zustand).
 *
 * The server owns the document; every mutation goes through the API and the
 * store mirrors the returned document + evaluation. Undo/redo is a client
 * stack of document snapshots restored via full-document replace — it is
 * deliberately distinct from the CAD feature timeline.
 */

import { create } from "zustand";
import type {
  BodyPayload,
  CadDocument,
  EvaluateResult,
  Feature,
  MeasureResult,
  PlaneRef,
  ProjectView,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchImport,
  Visibility,
} from "@rockett/shared";
import {
  emptyView,
  newId,
  solveSketch,
  createSketchOffset,
  editSketchOffset,
  constraintEntityRefs,
  trimSketch,
  withShown,
} from "@rockett/shared";
import { api, type MutationResponse } from "./api";
import { projectIdFromPath, projectPath, showPath } from "./paths";
import {
  previewTints,
  type PreviewGhost,
  type PreviewTint,
} from "./livePreview";
import { recoveryFor, writeQueue, type Recovery } from "./saving";

// ---------------------------------------------------------------------------

export type Selection =
  | { kind: "body"; bodyId: string }
  | { kind: "face"; bodyId: string; faceName: string }
  | { kind: "edge"; bodyId: string; edgeName: string }
  | { kind: "vertex"; bodyId: string; vertexName: string }
  | { kind: "plane"; ref: PlaneRef; label: string }
  | { kind: "profile"; sketchId: string; profileId: string }
  | { kind: "sketch"; sketchId: string }
  | {
      kind: "sketchEntity";
      sketchId: string;
      entityId: string;
      piece?: number[];
    }
  | { kind: "sketchPoint"; sketchId: string; entityId: string };

export function selectionKey(s: Selection): string {
  switch (s.kind) {
    case "body":
      return `body:${s.bodyId}`;
    case "face":
      return `face:${s.bodyId}:${s.faceName}`;
    case "edge":
      return `edge:${s.bodyId}:${s.edgeName}`;
    case "vertex":
      return `vertex:${s.bodyId}:${s.vertexName}`;
    case "plane":
      return `plane:${JSON.stringify(s.ref)}`;
    case "profile":
      return `profile:${s.sketchId}:${s.profileId}`;
    case "sketch":
      return `sketch:${s.sketchId}`;
    case "sketchEntity":
      return `se:${s.sketchId}:${s.entityId}`;
    case "sketchPoint":
      return `sp:${s.sketchId}:${s.entityId}`;
  }
}

export type SketchTool =
  | "select"
  | "line"
  | "rect"
  | "centerRect"
  | "circle"
  | "arc3"
  | "polygon"
  | "slot"
  | "point"
  | "project"
  | "trim"
  | "extend"
  | "offset"
  | "dimension";

export type DialogType =
  | "importStep"
  | "extrude"
  | "revolve"
  | "sweep"
  | "loft"
  | "fillet"
  | "chamfer"
  | "shell"
  | "combine"
  | "splitBody"
  | "offsetFace"
  | "mirror"
  | "linearPattern"
  | "circularPattern"
  | "constructionPlane"
  | "referenceImage"
  | "emboss"
  | "move"
  | "export";

export type Mode =
  | { name: "idle" }
  | { name: "pickPlane"; purpose: "sketch" }
  | {
      name: "sketch";
      sketchId: string;
      tool: SketchTool;
      constructionMode: boolean;
    }
  | { name: "dialog"; dialog: DialogType; editFeatureId?: string }
  | { name: "measure" };

function historyEditingState(
  mode: Mode,
  m: MutationResponse,
): Pick<State, "mode" | "draftSketch" | "selection"> {
  if (mode.name === "sketch") {
    const feature = m.document.features.find((f) => f.id === mode.sketchId);
    const solved = m.evaluation.sketches.find(
      (sk) => sk.featureId === mode.sketchId,
    );
    if (feature?.type === "sketch" && solved)
      return {
        mode: { ...mode, tool: "select" },
        selection: [],
        draftSketch: JSON.parse(
          JSON.stringify({ ...feature, entities: solved.entities }),
        ),
      };
  }
  return { mode: { name: "idle" }, draftSketch: null, selection: [] };
}

export function sketchEditingPosition(
  document: CadDocument,
  mode: Mode,
): number | undefined {
  if (mode.name !== "sketch") return undefined;
  const index = document.features.findIndex(
    (f) => f.id === mode.sketchId && f.type === "sketch",
  );
  return index < 0 ? undefined : index + 1;
}

interface State {
  projectId: string | null;
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
  view: ProjectView;
  busy: boolean;
  error: string | null;
  notSaved: string | null;
  saveState: "saved" | "saving" | "unsaved";
  recovery: Recovery | null;

  mode: Mode;
  dialogParams: Record<string, any>;
  selection: Selection[];
  hover: Selection | null;

  /** Local working copy of the sketch being edited (solved client-side). */
  draftSketch: SketchFeature | null;

  measureResult: MeasureResult | null;

  undoStack: CadDocument[];
  redoStack: CadDocument[];
  /**
   * Document snapshot taken before the first live dialog preview (e.g.
   * dragging the extrude gizmo while editing). Cancel restores it; a commit
   * uses it as the single undo entry for the whole interaction.
   */
  previewBaseline: CadDocument | null;

  // actions
  openProject: (id: string, path?: string) => Promise<void>;
  closeProject: () => void;
  applyMutation: (m: MutationResponse) => void;
  mutate: (fn: () => Promise<MutationResponse>) => Promise<void>;
  recover: (choice: "reapply" | "discard") => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setError: (e: string | null) => void;

  setSelection: (s: Selection[]) => void;
  toggleSelection: (s: Selection, additive: boolean) => void;
  setHover: (s: Selection | null) => void;

  setMode: (m: Mode) => void;
  setDialogParams: (p: Record<string, any>) => void;

  startSketchOnPlane: (ref: PlaneRef) => Promise<void>;
  editSketch: (sketchId: string) => Promise<void>;
  createOffset: (
    ids: string[],
    distance: number,
    autoChain: boolean,
    joinTolerance: number,
  ) => Promise<void>;
  editOffset: (id: string, distance: number) => Promise<void>;
  setSketchTool: (tool: SketchTool) => void;
  updateDraftSketch: (
    entities: SketchEntity[],
    constraints: SketchConstraint[],
  ) => void;
  solveDraft: (drag?: { pointId: string; x: number; y: number }) => void;
  commitDraftSketch: () => Promise<void>;
  finishSketch: () => Promise<void>;

  /** Delete sketch entities (and dependent curves/constraints) from the draft. */
  deleteSketchEntities: (entityIds: string[]) => Promise<void>;
  /** Toggle the construction flag on draft sketch curves. */
  toggleSketchConstruction: (entityIds: string[]) => Promise<void>;
  trimSketchCurve: (
    entityId: string,
    at: { x: number; y: number },
  ) => Promise<void>;
  insertSketchImport: (format: string, imported: SketchImport) => Promise<void>;

  addFeature: (feature: Feature) => Promise<void>;
  updateFeature: (fid: string, patch: Partial<Feature>) => Promise<void>;
  /** Live-preview edit: updates the feature WITHOUT pushing an undo entry. */
  updateFeaturePreview: (fid: string, patch: Partial<Feature>) => Promise<void>;
  previewNewFeature: (feature: Feature) => Promise<void>;
  /** Revert any live-preview edits made since the dialog opened. */
  cancelPreview: () => Promise<void>;
  deleteFeature: (fid: string) => Promise<void>;
  suppressFeature: (fid: string, suppressed: boolean) => Promise<void>;
  renameFeature: (fid: string, name: string) => Promise<void>;
  /** Rename the open project (display only — no regeneration, not an undo step). */
  renameProject: (name: string) => Promise<void>;
  rollTimeline: (position: number) => Promise<void>;
  setBodyMeta: (bodyId: string, patch: { name: string }) => Promise<void>;
  setVisible: (shown: Visibility) => Promise<void>;

  runMeasure: () => Promise<void>;
}

export function featurePatch(feature: Feature): Partial<Feature> {
  const { id: _id, suppressed: _suppressed, ...patch } = feature as any;
  if (!patch.name) delete patch.name;
  return patch;
}

const preview: {
  seq: number;
  pending: { fid: string; patch: Partial<Feature> } | null;
  inFlight: Promise<void> | null;
  provisional: { id: string; added: boolean } | null;
  base: { fid: string; bodies: BodyPayload[] } | null;
  error: string | null;
} = {
  seq: 0,
  pending: null,
  inFlight: null,
  provisional: null,
  base: null,
  error: null,
};

export function previewedFeature(s: {
  mode: Mode;
  document: CadDocument | null;
}): Feature | undefined {
  if (s.mode.name !== "dialog") return undefined;
  const id = s.mode.editFeatureId ?? preview.provisional?.id;
  return s.document?.features.find((f) => f.id === id);
}

function previewBodyTints(s: {
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
}): Map<string, PreviewTint> {
  const base = preview.base;
  const feature = s.document?.features.find((f) => f.id === base?.fid);
  if (!base || !feature || feature.suppressed || !s.evaluation)
    return new Map();
  return previewTints(feature, base.bodies, s.evaluation.bodies);
}

export function previewBodies(s: {
  mode: Mode;
  evaluation: EvaluateResult | null;
}): BodyPayload[] {
  return s.mode.name === "dialog" && preview.base
    ? preview.base.bodies
    : (s.evaluation?.bodies ?? []);
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
    ghosts: bodies.flatMap((body) => {
      const tint = tints.get(body.bodyId);
      return tint && !hidden.has(body.bodyId) ? [{ body, ...tint }] : [];
    }),
  };
}

export async function loadPreviewBase(fid: string): Promise<boolean> {
  const { document } = useStore.getState();
  const index = document?.features.findIndex((f) => f.id === fid) ?? -1;
  if (!document || index < 0 || index >= document.timelinePosition)
    return false;
  try {
    const { bodies } = await api.evaluate(document.id, index);
    const { mode, projectId } = useStore.getState();
    if (
      mode.name !== "dialog" ||
      mode.editFeatureId !== fid ||
      projectId !== document.id
    )
      return false;
    preview.base = { fid, bodies };
    return true;
  } catch {
    return false;
  }
}

async function sendPreviews(): Promise<void> {
  while (preview.pending) {
    const { fid, patch } = preview.pending;
    preview.pending = null;
    const seq = preview.seq;
    const { document, recovery } = useStore.getState();
    if (!document || recovery) break;
    const provisional =
      preview.provisional?.id === fid ? preview.provisional : null;
    try {
      const m = await inTurn(() =>
        provisional && !provisional.added
          ? api.addFeature(document.id, { ...patch, id: fid } as Feature)
          : api.updateFeature(
              document.id,
              fid,
              provisional ? featurePatch(patch as Feature) : patch,
            ),
      );
      if (provisional) provisional.added = true;
      if (seq === preview.seq)
        useStore.setState((s) => ({
          document: m.document,
          evaluation: m.evaluation,
          error: s.error === preview.error ? null : s.error,
        }));
    } catch (e: any) {
      if (lost(e)) break;
      if (seq === preview.seq) {
        preview.error = e.message;
        useStore.setState({ error: e.message });
      }
    }
  }
  preview.inFlight = null;
}

let writing = 0;
let unsent: Array<() => Promise<MutationResponse>> = [];

function saveState(s: State): Pick<State, "saveState"> {
  return {
    saveState: s.recovery ? "unsaved" : writing > 0 ? "saving" : "saved",
  };
}

const inTurn = writeQueue((count) => {
  writing = count;
  useStore.setState(saveState);
});

function lost(e: unknown): Recovery | null {
  const recovery = recoveryFor(e);
  if (recovery) {
    endPreviews();
    useStore.setState({ recovery, saveState: "unsaved" });
  }
  return recovery;
}

function endPreviews(): Promise<void> | null {
  preview.seq++;
  preview.pending = null;
  return preview.inFlight;
}

export function followPath(): Promise<void> | void {
  const id = projectIdFromPath(window.location.pathname);
  const s = useStore.getState();
  if (id === null) {
    if (s.projectId !== null) s.closeProject();
    return;
  }
  if (id !== s.projectId) return s.openProject(id);
}

export const useStore = create<State>((set, get) => ({
  projectId: null,
  document: null,
  evaluation: null,
  view: emptyView(),
  busy: false,
  error: null,
  notSaved: null,
  saveState: "saved",
  recovery: null,
  mode: { name: "idle" },
  dialogParams: {},
  selection: [],
  hover: null,
  draftSketch: null,
  measureResult: null,
  undoStack: [],
  redoStack: [],
  previewBaseline: null,

  async openProject(id, path = projectPath(id)) {
    void get().cancelPreview();
    set({ busy: true, error: null });
    try {
      const [{ document }, view] = await Promise.all([
        api.getProject(id),
        api.getView(id),
      ]);
      const evaluation = await api.evaluate(id);
      set({
        projectId: id,
        document,
        evaluation,
        view,
        undoStack: [],
        redoStack: [],
        selection: [],
        mode: { name: "idle" },
        draftSketch: null,
        dialogParams: {},
        previewBaseline: null,
        recovery: null,
        saveState: "saved",
        busy: false,
      });
      unsent = [];
      showPath(path);
    } catch (e: any) {
      window.history.replaceState(null, "", "/");
      get().closeProject();
      set({ error: e.message });
    }
  },

  closeProject() {
    void get().cancelPreview();
    unsent = [];
    set({
      recovery: null,
      saveState: "saved",
      error: null,
      projectId: null,
      document: null,
      evaluation: null,
      view: emptyView(),
      selection: [],
      mode: { name: "idle" },
      undoStack: [],
      redoStack: [],
      draftSketch: null,
      dialogParams: {},
      previewBaseline: null,
      busy: false,
    });
  },

  applyMutation(m) {
    set({ document: m.document, evaluation: m.evaluation });
  },

  async mutate(fn) {
    if (!get().document) return;
    await endPreviews();
    return inTurn(async () => {
      const { document, previewBaseline, recovery } = get();
      if (!document) return;
      if (recovery) {
        unsent.push(fn);
        throw new Error(recovery.message);
      }
      // If live previews already changed the document, the undo entry for this
      // commit is the state from before the previews started.
      const snapshot = previewBaseline ?? JSON.parse(JSON.stringify(document));
      set({ busy: true, error: null });
      try {
        const m = await fn();
        preview.base = null;
        set((s) => ({
          document: m.document,
          evaluation: m.evaluation,
          undoStack: [...s.undoStack.slice(-49), snapshot],
          redoStack: [],
          previewBaseline: null,
          busy: false,
        }));
      } catch (e: any) {
        if (lost(e)) unsent.push(fn);
        set((s) => ({ error: s.recovery ? null : e.message, busy: false }));
        throw e;
      }
    });
  },

  async recover(choice) {
    const { document, recovery } = get();
    if (!document || !recovery) return;
    endPreviews();
    preview.provisional = null;
    preview.base = null;
    set({ busy: true, error: null });
    const reloaded = await inTurn(async () => {
      try {
        const latest = (await api.getProject(document.id)).document;
        const mode = get().mode;
        const evaluation = await api.evaluate(
          document.id,
          sketchEditingPosition(latest, mode),
        );
        set({
          document: latest,
          evaluation,
          previewBaseline: null,
          recovery: null,
          undoStack: [],
          redoStack: [],
          busy: false,
          ...historyEditingState(mode, { document: latest, evaluation }),
        });
        return true;
      } catch (e: any) {
        set({ busy: false, recovery: lost(e) ?? recovery });
        return false;
      }
    });
    if (!reloaded) return;
    const replay = choice === "reapply" ? unsent : [];
    unsent = [];
    for (const fn of replay)
      await get()
        .mutate(fn)
        .catch(() => {});
  },

  async updateFeaturePreview(fid, patch) {
    const { document, evaluation, previewBaseline, recovery } = get();
    if (!document || recovery) return;
    if (!previewBaseline) {
      preview.base ??= { fid, bodies: evaluation?.bodies ?? [] };
      set({ previewBaseline: JSON.parse(JSON.stringify(document)) });
    }
    preview.seq++;
    preview.pending =
      preview.pending?.fid === fid
        ? {
            fid,
            patch: { ...preview.pending.patch, ...patch } as Partial<Feature>,
          }
        : { fid, patch };
    preview.inFlight ??= sendPreviews();
    return preview.inFlight;
  },

  async previewNewFeature(feature) {
    if (!get().document) return;
    preview.provisional ??= { id: feature.id, added: false };
    return get().updateFeaturePreview(preview.provisional.id, feature);
  },

  async cancelPreview() {
    const { previewBaseline } = get();
    const settling = endPreviews();
    preview.provisional = null;
    preview.base = null;
    if (!previewBaseline) return;
    if (get().recovery) return set({ previewBaseline: null });
    const current = () => get().projectId === previewBaseline.id;
    set({ busy: true });
    try {
      await settling;
      const m = await inTurn(() =>
        api.replaceDocument(previewBaseline.id, previewBaseline),
      );
      if (current())
        set({
          document: m.document,
          evaluation: m.evaluation,
          previewBaseline: null,
          busy: false,
        });
    } catch (e: any) {
      if (current())
        set({
          error: lost(e) ? null : e.message,
          previewBaseline: null,
          busy: false,
        });
    }
  },

  async undo() {
    const { undoStack, document, projectId, mode, busy, recovery } = get();
    if (busy || recovery || !projectId || !document || undoStack.length === 0)
      return;
    const prev = undoStack[undoStack.length - 1]!;
    set({ busy: true });
    try {
      const m = await inTurn(() =>
        api.replaceDocument(projectId, prev, sketchEditingPosition(prev, mode)),
      );
      set((s) => ({
        document: m.document,
        evaluation: m.evaluation,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, JSON.parse(JSON.stringify(document))],
        busy: false,
        ...historyEditingState(mode, m),
      }));
    } catch (e: any) {
      set({ error: lost(e) ? null : e.message, busy: false });
    }
  },

  async redo() {
    const { redoStack, document, projectId, mode, busy, recovery } = get();
    if (busy || recovery || !projectId || !document || redoStack.length === 0)
      return;
    const next = redoStack[redoStack.length - 1]!;
    set({ busy: true });
    try {
      const m = await inTurn(() =>
        api.replaceDocument(projectId, next, sketchEditingPosition(next, mode)),
      );
      set((s) => ({
        document: m.document,
        evaluation: m.evaluation,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, JSON.parse(JSON.stringify(document))],
        busy: false,
        ...historyEditingState(mode, m),
      }));
    } catch (e: any) {
      set({ error: lost(e) ? null : e.message, busy: false });
    }
  },

  setError: (e) => set({ error: e }),

  setSelection: (s) => set({ selection: s, measureResult: null }),
  toggleSelection(s, additive) {
    const { selection } = get();
    const key = selectionKey(s);
    const exists = selection.some((x) => selectionKey(x) === key);
    if (additive) {
      set({
        selection: exists
          ? selection.filter((x) => selectionKey(x) !== key)
          : [...selection, s],
      });
    } else {
      set({ selection: exists && selection.length === 1 ? [] : [s] });
    }
  },
  setHover: (s) => set({ hover: s }),

  setMode: (m) => set({ mode: m, dialogParams: {}, measureResult: null }),
  setDialogParams: (p) =>
    set((s) => ({ dialogParams: { ...s.dialogParams, ...p } })),

  async startSketchOnPlane(ref) {
    const { document } = get();
    if (!document) return;
    const feature: SketchFeature = {
      id: newId("sketch"),
      type: "sketch",
      name: "",
      suppressed: false,
      plane: ref,
      entities: [],
      constraints: [],
    };
    await get().mutate(() => api.addFeature(document.id, feature));
    const doc = get().document!;
    const created = doc.features.find(
      (f) => f.id === feature.id,
    ) as SketchFeature;
    set({
      mode: {
        name: "sketch",
        sketchId: feature.id,
        tool: "line",
        constructionMode: false,
      },
      draftSketch: JSON.parse(JSON.stringify(created)),
      selection: [],
    });
  },

  async editSketch(sketchId) {
    if (get().busy) return;
    if (get().mode.name === "sketch") {
      if ((get().mode as { sketchId: string }).sketchId === sketchId) return;
      await get().finishSketch();
      if (get().mode.name === "sketch") return;
    }
    const { document } = get();
    const feature = document?.features.find(
      (f) => f.id === sketchId && f.type === "sketch",
    ) as SketchFeature | undefined;
    if (!feature || !document || feature.suppressed) return;
    set({ busy: true, error: null });
    try {
      const evaluation = await api.evaluate(
        document.id,
        document.features.indexOf(feature) + 1,
      );
      if (get().projectId !== document.id) return;
      const solved = evaluation.sketches.find(
        (sk) => sk.featureId === sketchId,
      );
      if (!solved)
        throw new Error(
          evaluation.featureStatuses.find((f) => f.featureId === sketchId)
            ?.error ?? "Sketch could not be evaluated.",
        );
      set({
        evaluation,
        busy: false,
        dialogParams: {},
        mode: {
          name: "sketch",
          sketchId,
          tool: "select",
          constructionMode: false,
        },
        draftSketch: {
          ...JSON.parse(JSON.stringify(feature)),
          entities: JSON.parse(JSON.stringify(solved.entities)),
        },
        selection: [],
      });
    } catch (e: any) {
      if (get().projectId === document.id)
        set({ busy: false, error: e.message });
    }
  },

  async createOffset(ids, distance, autoChain, joinTolerance) {
    const { draftSketch, busy } = get();
    if (!draftSketch || busy) return;
    const next = createSketchOffset(
      draftSketch,
      ids,
      distance,
      autoChain,
      joinTolerance,
    );
    set({ draftSketch: next });
    try {
      await get().commitDraftSketch();
    } catch (e) {
      set({ draftSketch });
      throw e;
    }
  },

  async editOffset(id, distance) {
    const { draftSketch, busy } = get();
    if (!draftSketch || busy) return;
    const next = editSketchOffset(draftSketch, id, distance);
    const solved = solveSketch({
      entities: next.entities,
      constraints: next.constraints,
    });
    const owned = new Set((next.offsets ?? []).flatMap((o) => o.entityIds));
    if (
      !solved.converged ||
      solved.entities.some((e, i) => {
        const before = next.entities[i];
        return (
          owned.has(e.id) &&
          ((e.kind === "point" &&
            before?.kind === "point" &&
            Math.hypot(e.x - before.x, e.y - before.y) > 1e-5) ||
            (e.kind === "circle" &&
              before?.kind === "circle" &&
              Math.abs(e.radius - before.radius) > 1e-5))
        );
      })
    )
      throw new Error(
        "Sketch constraints conflict with this offset distance. Remove conflicting dimensions first.",
      );
    set({ draftSketch: { ...next, entities: solved.entities } });
    try {
      await get().commitDraftSketch();
    } catch (e) {
      set({ draftSketch });
      throw e;
    }
  },

  setSketchTool(tool) {
    const { mode } = get();
    if (mode.name !== "sketch") return;
    set({
      mode: { ...mode, tool },
      selection: [],
      ...(tool === "offset"
        ? {
            dialogParams: {
              ...get().dialogParams,
              offsetManualSelection: false,
              editOffsetId: undefined,
            },
          }
        : {}),
    });
  },

  updateDraftSketch(entities, constraints) {
    const { draftSketch } = get();
    if (!draftSketch) return;
    const updated = { ...draftSketch, entities, constraints };
    const solved = solveSketch({ entities, constraints });
    if (solved.converged) {
      updated.entities = solved.entities;
    }
    set({ draftSketch: updated });
  },

  solveDraft(drag) {
    const { draftSketch } = get();
    if (!draftSketch) return;
    const solved = solveSketch({
      entities: draftSketch.entities,
      constraints: draftSketch.constraints,
      ...(drag === undefined ? {} : { drag }),
    });
    set({ draftSketch: { ...draftSketch, entities: solved.entities } });
  },

  async commitDraftSketch() {
    const { draftSketch, document } = get();
    if (!draftSketch || !document) return;
    const saved = document.features.find((f) => f.id === draftSketch.id);
    if (
      saved?.type === "sketch" &&
      JSON.stringify([
        saved.entities,
        saved.constraints,
        saved.offsets ?? [],
      ]) ===
        JSON.stringify([
          draftSketch.entities,
          draftSketch.constraints,
          draftSketch.offsets ?? [],
        ])
    )
      return;
    await get().mutate(() =>
      api.updateFeature(
        document.id,
        draftSketch.id,
        {
          entities: draftSketch.entities,
          constraints: draftSketch.constraints,
          offsets: draftSketch.offsets,
        } as Partial<Feature>,
        sketchEditingPosition(document, get().mode),
      ),
    );
    // refresh draft from authoritative solve
    const evaluation = get().evaluation;
    const solvedSketch = evaluation?.sketches.find(
      (s) => s.featureId === draftSketch.id,
    );
    if (solvedSketch) {
      set((s) => ({
        draftSketch: s.draftSketch
          ? {
              ...s.draftSketch,
              entities: solvedSketch.entities as SketchEntity[],
            }
          : null,
      }));
    }
  },

  async finishSketch() {
    if (get().busy || get().mode.name !== "sketch") return;
    try {
      await get().commitDraftSketch();
      const doc = get().document;
      if (!doc) return;
      set({ busy: true });
      const evaluation = await api.evaluate(doc.id);
      if (get().projectId !== doc.id) return;
      set({
        evaluation,
        busy: false,
        mode: { name: "idle" },
        draftSketch: null,
        selection: [],
        dialogParams: {},
      });
    } catch (e: any) {
      set({ busy: false, error: e.message });
    }
  },

  async deleteSketchEntities(entityIds) {
    const { draftSketch } = get();
    if (!draftSketch || entityIds.length === 0) return;
    const idSet = new Set(entityIds);

    // points referenced by curves being deleted (candidates for cleanup)
    const deletedCurvePoints = new Set<string>();
    for (const e of draftSketch.entities) {
      const gone =
        idSet.has(e.id) ||
        (e.kind === "line" && (idSet.has(e.p1) || idSet.has(e.p2))) ||
        (e.kind === "circle" && idSet.has(e.center)) ||
        (e.kind === "arc" &&
          (idSet.has(e.center) || idSet.has(e.start) || idSet.has(e.end)));
      if (gone) {
        if (e.kind === "line") {
          deletedCurvePoints.add(e.p1);
          deletedCurvePoints.add(e.p2);
        } else if (e.kind === "circle") {
          deletedCurvePoints.add(e.center);
        } else if (e.kind === "arc") {
          deletedCurvePoints.add(e.center);
          deletedCurvePoints.add(e.start);
          deletedCurvePoints.add(e.end);
        }
      }
    }

    let entities = draftSketch.entities.filter((e) => {
      if (idSet.has(e.id)) return false;
      if (e.kind === "line" && (idSet.has(e.p1) || idSet.has(e.p2)))
        return false;
      if (e.kind === "circle" && idSet.has(e.center)) return false;
      if (
        e.kind === "arc" &&
        (idSet.has(e.center) || idSet.has(e.start) || idSet.has(e.end))
      )
        return false;
      return true;
    });

    // drop endpoints orphaned by the deletion (still keep user-placed points)
    const stillUsed = new Set<string>();
    for (const e of entities) {
      if (e.kind === "line") {
        stillUsed.add(e.p1);
        stillUsed.add(e.p2);
      } else if (e.kind === "circle") {
        stillUsed.add(e.center);
      } else if (e.kind === "arc") {
        stillUsed.add(e.center);
        stillUsed.add(e.start);
        stillUsed.add(e.end);
      }
    }
    entities = entities.filter(
      (e) =>
        e.kind !== "point" ||
        stillUsed.has(e.id) ||
        !deletedCurvePoints.has(e.id),
    );

    // A connected endpoint may survive deletion of its projected curve.
    // Release that point rather than leaving a frozen, unlinked reference.
    const drivenPoints = new Set<string>();
    for (const e of entities) {
      if (e.kind === "point" || !e.projection) continue;
      if (e.kind === "line") {
        drivenPoints.add(e.p1);
        drivenPoints.add(e.p2);
      } else if (e.kind === "circle") drivenPoints.add(e.center);
      else {
        drivenPoints.add(e.center);
        drivenPoints.add(e.start);
        drivenPoints.add(e.end);
      }
    }
    entities = entities.map((e) =>
      e.kind === "point" &&
      e.external &&
      deletedCurvePoints.has(e.id) &&
      !drivenPoints.has(e.id)
        ? { ...e, external: false }
        : e,
    );

    const remaining = new Set(entities.map((e) => e.id));
    const constraints = draftSketch.constraints.filter((c) =>
      constraintEntityRefs(c).every((r) => remaining.has(r)),
    );
    get().updateDraftSketch(entities, constraints);
    await get().commitDraftSketch();
    set({ selection: [] });
  },

  async trimSketchCurve(entityId, at) {
    const { draftSketch, busy } = get();
    if (!draftSketch || busy) return;
    const result = trimSketch(
      draftSketch.entities,
      draftSketch.constraints,
      entityId,
      at,
    );
    get().updateDraftSketch(result.entities, result.constraints);
    try {
      await get().commitDraftSketch();
    } catch (e) {
      set({ draftSketch });
      throw e;
    }
    set({
      hover: null,
      ...(result.removedConstraints && {
        error: `${result.removedConstraints} constraint(s) on the trimmed piece were removed. Undo restores them.`,
      }),
    });
  },

  async toggleSketchConstruction(entityIds) {
    const { draftSketch } = get();
    if (!draftSketch || entityIds.length === 0) return;
    const idSet = new Set(entityIds);
    const entities = draftSketch.entities.map((e) =>
      idSet.has(e.id) ? { ...e, construction: !e.construction } : e,
    );
    get().updateDraftSketch(
      entities as SketchEntity[],
      draftSketch.constraints,
    );
    await get().commitDraftSketch();
  },

  async insertSketchImport(format, imported) {
    const { draftSketch, busy } = get();
    if (!draftSketch || busy) return;
    const skipped =
      imported.skipped === 0
        ? ""
        : `Skipped ${imported.skipped} unsupported ${format} ${imported.skipped === 1 ? "entity" : "entities"}.`;
    if (imported.entities.length === 0) {
      set({
        error:
          `This ${format} file has no lines, arcs, circles or points to insert. ${skipped}`.trim(),
      });
      return;
    }
    get().updateDraftSketch(
      [...draftSketch.entities, ...imported.entities],
      draftSketch.constraints,
    );
    try {
      await get().commitDraftSketch();
    } catch {
      set({ draftSketch });
      return;
    }
    if (skipped) set({ error: skipped });
  },

  async addFeature(feature) {
    const { document } = get();
    if (!document) return;
    // name left empty → the server assigns Sketch1/Extrude2/… and persists
    // the per-type counter.
    await get().mutate(() =>
      preview.provisional?.added
        ? api.updateFeature(
            document.id,
            preview.provisional.id,
            featurePatch(feature),
          )
        : api.addFeature(document.id, feature),
    );
    preview.provisional = null;
  },

  async updateFeature(fid, patch) {
    const { document } = get();
    if (!document) return;
    await get().mutate(() =>
      api.updateFeature(
        document.id,
        fid,
        patch,
        sketchEditingPosition(document, get().mode),
      ),
    );
  },

  async deleteFeature(fid) {
    const { document } = get();
    if (!document) return;
    await get().mutate(() => api.deleteFeature(document.id, fid));
    set({ selection: [] });
  },

  async suppressFeature(fid, suppressed) {
    await get().updateFeature(fid, { suppressed } as Partial<Feature>);
  },

  async renameFeature(fid, name) {
    await get().updateFeature(fid, { name } as Partial<Feature>);
  },

  async renameProject(name) {
    const { document } = get();
    const trimmed = name.trim();
    if (!document || !trimmed || trimmed === document.name) return;
    try {
      const { document: renamed } = await inTurn(() =>
        api.renameProject(document.id, trimmed),
      );
      // only the name changed server-side; keep whatever else is in the store
      const current = get().document;
      if (current && current.id === renamed.id) {
        set({ document: { ...current, name: renamed.name } });
      }
    } catch (e: any) {
      if (!lost(e)) set({ error: e.message });
    }
  },

  async rollTimeline(position) {
    if (get().mode.name === "sketch" || get().busy) return;
    const { document } = get();
    if (!document) return;
    await get().mutate(() => api.setTimeline(document.id, position));
  },

  async setBodyMeta(bodyId, patch) {
    const { document } = get();
    if (!document) return;
    await get().mutate(() => api.updateBody(document.id, bodyId, patch));
  },

  async setVisible(shown) {
    const { projectId, view } = get();
    if (!projectId) return;
    const next = withShown(view, shown);
    set({ view: next });
    try {
      await inTurn(() => api.putView(projectId, next));
    } catch (e: any) {
      if (get().projectId === projectId) set({ error: e.message });
    }
  },

  async runMeasure() {
    const { selection, document } = get();
    if (!document) return;
    const refs = selection
      .filter(
        (s) => s.kind === "face" || s.kind === "edge" || s.kind === "vertex",
      )
      .slice(0, 2) as any[];
    if (refs.length === 0) {
      set({ measureResult: null });
      return;
    }
    try {
      const result = await api.measure(document.id, refs);
      set({ measureResult: result });
    } catch (e: any) {
      set({ error: e.message });
    }
  },
}));
