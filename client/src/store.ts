/**
 * Central client state (zustand).
 *
 * The server owns the document and its undo history; every mutation goes
 * through the API and the store mirrors the returned document, evaluation
 * and history status.
 */

import { create } from "zustand";
import type {
  BodyPayload,
  CadDocument,
  EvaluateResult,
  Feature,
  HistoryStatus,
  MeasureResult,
  OriginAxis,
  PlaneRef,
  ProjectView,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchImport,
  TopoRef,
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
  | { kind: "axis"; axis: OriginAxis }
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
    case "axis":
      return `axis:${s.axis}`;
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

const measurable = (s: Selection): s is TopoRef =>
  s.kind === "face" || s.kind === "edge" || s.kind === "vertex";

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
  job: { label: string; done: number; total: number } | null;
  jobStartedAt: number | null;
  error: string | null;
  notSaved: string | null;
  saveState: "saved" | "saving" | "unsaved";
  recovery: Recovery | null;
  history: HistoryStatus | null;

  mode: Mode;
  dialogParams: Record<string, any>;
  pickInput: string | null;
  selection: Selection[];
  hover: Selection | null;

  /** Local working copy of the sketch being edited (solved client-side). */
  draftSketch: SketchFeature | null;

  measureResult: MeasureResult | null;

  // actions
  openProject: (id: string, path?: string) => Promise<void>;
  closeProject: () => void;
  applyMutation: (m: MutationResponse) => void;
  mutate: (fn: (tx: string) => Promise<MutationResponse>) => Promise<void>;
  recover: (choice: "reapply" | "discard") => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setError: (e: string | null) => void;
  cancelJob: () => Promise<void>;

  setSelection: (s: Selection[]) => void;
  toggleSelection: (s: Selection, additive: boolean) => void;
  setHover: (s: Selection | null) => void;

  setMode: (m: Mode) => void;
  cancelDialog: () => void;
  setDialogParams: (p: Record<string, any>) => void;
  setPickInput: (key: string) => void;

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
  /** Live-preview edit, staged by the server in the dialog's transaction. */
  updateFeaturePreview: (fid: string, patch: Partial<Feature>) => Promise<void>;
  previewNewFeature: (feature: Feature) => Promise<void>;
  /** Abort the dialog's preview transaction. */
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

interface Session {
  tx: string;
  fid: string;
  fresh: boolean;
  staged: number;
}

const preview: {
  seq: number;
  pending: { fid: string; patch: Partial<Feature> } | null;
  inFlight: Promise<void> | null;
  session: Session | null;
  base: {
    fid: string;
    bodies: BodyPayload[];
    after?: BodyPayload[] | undefined;
  } | null;
  error: string | null;
} = {
  seq: 0,
  pending: null,
  inFlight: null,
  session: null,
  base: null,
  error: null,
};

function take(fresh: boolean, fid?: string): Session | null {
  const session = preview.session;
  if (!session || session.fresh !== fresh || (fid && session.fid !== fid))
    return null;
  preview.session = null;
  return session;
}

function committing(
  id: string,
  session: Session,
  patch: Partial<Feature>,
  plain: (tx: string) => Promise<MutationResponse>,
): () => Promise<MutationResponse> {
  let step: "stage" | "commit" | "plain" = "stage";
  return async () => {
    if (session.staged === 0) step = "plain";
    try {
      if (step === "stage") {
        const seq = session.staged + 1;
        await api.updateFeature(
          id,
          session.fid,
          patch,
          undefined,
          session.tx,
          seq,
        );
        session.staged = seq;
        step = "commit";
      }
      if (step === "commit") return await api.commitPreview(id, session.tx);
    } catch (e: any) {
      if (e?.status !== 404 && e?.status !== 409) throw e;
      step = "plain";
      if (e.status === 409) throw e;
    }
    return plain(session.tx);
  };
}

export function dialogFeatureId(mode: Mode): string | undefined {
  if (mode.name === "dialog")
    return (
      mode.editFeatureId ??
      (preview.session?.fresh ? preview.session.fid : undefined)
    );
}

export function previewedFeature(s: {
  mode: Mode;
  document: CadDocument | null;
}): Feature | undefined {
  const id = dialogFeatureId(s.mode);
  return s.document?.features.find((f) => f.id === id);
}

function previewAfter(s: { evaluation: EvaluateResult | null }): BodyPayload[] {
  return preview.base?.after ?? s.evaluation?.bodies ?? [];
}

function previewBodyTints(s: {
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
}): Map<string, PreviewTint> {
  const base = preview.base;
  const feature = s.document?.features.find((f) => f.id === base?.fid);
  if (!base || !feature || feature.suppressed || !s.evaluation)
    return new Map();
  return previewTints(feature, base.bodies, previewAfter(s));
}

async function bodiesAfter(
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
    ghosts: previewAfter(s).flatMap((body) => {
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
    const [{ bodies }, after] = await Promise.all([
      api.evaluate(document.id, index),
      bodiesAfter(document, fid),
    ]);
    const { mode, projectId } = useStore.getState();
    if (
      mode.name !== "dialog" ||
      mode.editFeatureId !== fid ||
      projectId !== document.id
    )
      return false;
    const landed = preview.base?.fid === fid ? preview.base.after : undefined;
    preview.base = { fid, bodies, after: landed ?? after };
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
    const session = preview.session;
    if (!document || recovery || !session) break;
    try {
      const m = await inTurn(() =>
        session.fresh && session.staged === 0
          ? api.addFeature(
              document.id,
              { ...patch, id: fid } as Feature,
              session.tx,
              1,
            )
          : api.updateFeature(
              document.id,
              fid,
              session.fresh ? featurePatch(patch as Feature) : patch,
              undefined,
              session.tx,
              session.staged + 1,
            ),
      );
      session.staged++;
      if (seq !== preview.seq) continue;
      const after = await bodiesAfter(m.document, fid);
      if (seq !== preview.seq) continue;
      if (preview.base?.fid === fid) preview.base.after = after;
      useStore.setState((s) => ({
        document: m.document,
        evaluation: m.evaluation,
        history: m.history ?? s.history,
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

let selectionBeforeDialog: Selection[] = [];
let writing = 0;
let unsent: Array<(tx: string) => Promise<MutationResponse>> = [];

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

async function saveDialog(
  session: Session | null,
  commit: (session: Session) => () => Promise<MutationResponse>,
  plain: (tx: string) => Promise<MutationResponse>,
): Promise<void> {
  const { mutate } = useStore.getState();
  try {
    await mutate(session ? commit(session) : plain);
  } catch (e) {
    if (session && !useStore.getState().recovery) preview.session ??= session;
    throw e;
  }
}

async function moveHistory(way: "undo" | "redo"): Promise<void> {
  const { history, document, projectId, mode, busy, recovery } =
    useStore.getState();
  const able = way === "undo" ? history?.canUndo : history?.canRedo;
  if (busy || recovery || !projectId || !document || !able) return;
  useStore.setState({ busy: true });
  const position = sketchEditingPosition(document, mode);
  try {
    const m = await inTurn(() =>
      api[way](projectId, position).catch((e) => {
        if (e?.status !== 400 || position === undefined) throw e;
        return api[way](projectId);
      }),
    );
    useStore.setState({
      document: m.document,
      evaluation: m.evaluation,
      history: m.history ?? null,
      busy: false,
      ...historyEditingState(mode, m),
    });
  } catch (e: any) {
    useStore.setState({ error: lost(e) ? null : e.message, busy: false });
  }
}

export const useStore = create<State>((set, get) => ({
  projectId: null,
  document: null,
  evaluation: null,
  view: emptyView(),
  busy: false,
  job: null,
  jobStartedAt: null,
  error: null,
  notSaved: null,
  saveState: "saved",
  recovery: null,
  history: null,
  mode: { name: "idle" },
  dialogParams: {},
  pickInput: null,
  selection: [],
  hover: null,
  draftSketch: null,
  measureResult: null,

  async openProject(id, path = projectPath(id)) {
    void get().cancelPreview();
    api.forgetJob?.();
    set({ busy: true, error: null, job: null, jobStartedAt: null });
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
        history: null,
        selection: [],
        mode: { name: "idle" },
        draftSketch: null,
        dialogParams: {},
        recovery: null,
        saveState: "saved",
        busy: false,
      });
      unsent = [];
      showPath(path);
    } catch (e: any) {
      if (e?.status === 401) return set({ busy: false });
      window.history.replaceState(null, "", "/");
      get().closeProject();
      set({ error: e.message });
    }
  },
  closeProject() {
    void get().cancelPreview();
    api.forgetJob?.();
    unsent = [];
    api.forgetMeshes();
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
      history: null,
      draftSketch: null,
      dialogParams: {},
      busy: false,
      job: null,
      jobStartedAt: null,
    });
  },

  applyMutation(m) {
    set({ document: m.document, evaluation: m.evaluation });
  },

  async mutate(fn) {
    if (!get().document) return;
    await endPreviews();
    const tx = crypto.randomUUID();
    return inTurn(async () => {
      const { document, recovery } = get();
      if (!document) return;
      if (recovery) {
        unsent.push(fn);
        throw new Error(recovery.message);
      }
      set({ busy: true, error: null });
      try {
        const m = await fn(tx);
        preview.base = null;
        set({
          document: m.document,
          evaluation: m.evaluation,
          history: m.history ?? null,
          busy: false,
        });
      } catch (e: any) {
        if (lost(e)) unsent.push(() => fn(tx));
        set((s) => ({ error: s.recovery ? null : e.message, busy: false }));
        throw e;
      }
    });
  },

  async recover(choice) {
    const { document, recovery } = get();
    if (!document || !recovery) return;
    endPreviews();
    preview.session = null;
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
          recovery: null,
          history: null,
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
    const { document, evaluation, recovery } = get();
    if (!document || recovery) return;
    preview.base ??= { fid, bodies: evaluation?.bodies ?? [] };
    preview.session ??= {
      tx: crypto.randomUUID(),
      fid,
      fresh: false,
      staged: 0,
    };
    preview.seq++;
    const { targets: _replaced, ...queued }: Record<string, unknown> =
      preview.pending?.fid === fid ? preview.pending.patch : {};
    preview.pending = { fid, patch: { ...queued, ...patch } };
    preview.inFlight ??= sendPreviews();
    return preview.inFlight;
  },

  async previewNewFeature(feature) {
    if (!get().document) return;
    preview.session ??= {
      tx: crypto.randomUUID(),
      fid: feature.id,
      fresh: true,
      staged: 0,
    };
    return get().updateFeaturePreview(preview.session.fid, feature);
  },

  async cancelPreview() {
    const { document, recovery } = get();
    const settling = endPreviews();
    const session = preview.session;
    preview.session = null;
    preview.base = null;
    if (!document || !session || recovery) return;
    const current = () => get().projectId === document.id;
    set({ busy: true });
    try {
      await settling;
      const m =
        session.staged > 0
          ? await inTurn(() => api.abortPreview(document.id, session.tx))
          : null;
      if (current())
        set({
          ...(m && {
            document: m.document,
            evaluation: m.evaluation,
            history: m.history ?? null,
          }),
          busy: false,
        });
    } catch (e: any) {
      if (current()) set({ error: lost(e) ? null : e.message, busy: false });
    }
  },

  undo: () => moveHistory("undo"),
  redo: () => moveHistory("redo"),

  setError: (e) => set({ error: e }),
  async cancelJob() {
    try {
      await api.cancelJob();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

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

  setMode(m) {
    const { mode, selection } = get();
    if (m.name === "dialog" && mode.name !== "dialog")
      selectionBeforeDialog = selection;
    set({
      mode: m,
      dialogParams: {},
      pickInput: null,
      measureResult: null,
      selection:
        m.name === "measure" ? selection.filter(measurable) : selection,
    });
  },
  cancelDialog() {
    get().setMode({ name: "idle" });
    set({ selection: selectionBeforeDialog });
  },
  setDialogParams: (p) =>
    set((s) => ({ dialogParams: { ...s.dialogParams, ...p } })),
  setPickInput: (key) => set({ pickInput: key }),

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
    await get().mutate((tx) => api.addFeature(document.id, feature, tx));
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
    await get().mutate((tx) =>
      api.updateFeature(
        document.id,
        draftSketch.id,
        {
          entities: draftSketch.entities,
          constraints: draftSketch.constraints,
          offsets: draftSketch.offsets,
        } as Partial<Feature>,
        sketchEditingPosition(document, get().mode),
        tx,
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
    const plain = (tx: string) => api.addFeature(document.id, feature, tx);
    await saveDialog(
      take(true),
      (session) =>
        committing(document.id, session, featurePatch(feature), plain),
      plain,
    );
  },

  async updateFeature(fid, patch) {
    const { document } = get();
    if (!document) return;
    const plain = (tx: string) =>
      api.updateFeature(
        document.id,
        fid,
        patch,
        sketchEditingPosition(document, get().mode),
        tx,
      );
    await saveDialog(
      take(false, fid),
      (session) => committing(document.id, session, patch, plain),
      plain,
    );
  },

  async deleteFeature(fid) {
    const { document } = get();
    if (!document) return;
    await get().mutate((tx) => api.deleteFeature(document.id, fid, tx));
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
    await get().mutate((tx) => api.setTimeline(document.id, position, tx));
  },

  async setBodyMeta(bodyId, patch) {
    const { document } = get();
    if (!document) return;
    await get().mutate((tx) => api.updateBody(document.id, bodyId, patch, tx));
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
    const refs = selection.filter(measurable).slice(0, 2);
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

api.watchJob?.((event) => {
  if (event.type === "start") {
    useStore.setState({ job: null, jobStartedAt: Date.now() });
    return;
  }
  if (event.type === "progress") {
    useStore.setState({
      job: { label: event.label, done: event.done, total: event.total },
    });
    return;
  }
  useStore.setState((state) => ({
    job: null,
    jobStartedAt: null,
    ...(event.type === "cancelled" && {
      error: state.error ?? "Job cancelled.",
    }),
    ...(event.type === "failed" && { error: state.error ?? "Job failed." }),
  }));
});
