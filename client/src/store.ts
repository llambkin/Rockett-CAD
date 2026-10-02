import { create } from "zustand";
import type { Active } from "./commands/active";
import type {
  CadDocument,
  EvaluateResult,
  Feature,
  FeatureType,
  HistoryStatus,
  OpenedProject,
  PlaneRef,
  ProjectView,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchImport,
  TrimTarget,
  ViewCamera,
  Visibility,
} from "@rockett/shared";
import {
  emptyView,
  newId,
  solveSketch,
  editedEntities,
  OverConstrainedError,
  createSketchOffset,
  editSketchOffset,
  constraintEntityRefs,
  trimSketchPieces,
  withShown,
} from "@rockett/shared";
import { api, type MutationResponse } from "./api";
import * as cameraSave from "./cameraSave";
import { projectIdFromPath, projectPath, showPath } from "./paths";
import * as previewBase from "./previewBase";
export { previewBodies } from "./previewBase";
import { recoveryFor, writeQueue, type Recovery } from "./saving";
import { historyEditingState, sketchEditingPosition } from "./sketchEditing";

import {
  selectionBeforeCommand,
  selectionKey,
  type Selection,
} from "./selection/kinds";
export { selectionKey, type Selection } from "./selection/kinds";

import {
  sketchState,
  type SketchState,
  type SketchTool,
} from "./commands/sketch";
export type { SketchTool } from "./commands/sketch";

export type DialogType = FeatureType | "export";

export type Mode = { name: "idle" };

interface State {
  projectId: string | null;
  access: OpenedProject["access"] | null;
  document: CadDocument | null;
  evaluation: EvaluateResult | null;
  view: ProjectView;
  busy: boolean;
  job: { label: string; done: number; total: number } | null;
  jobStartedAt: number | null;
  error: string | null;
  notSaved: string | null;
  saveState: "saved" | "saving" | "unsaved";
  savedAt: number | null;
  recovery: Recovery | null;
  history: HistoryStatus | null;

  mode: Mode;
  dialogParams: Record<string, any>;
  pickInput: string | null;
  selection: Selection[];
  hover: Selection | null;

  draftSketch: SketchFeature | null;

  active: Active | null;

  openProject: (id: string, path?: string) => Promise<void>;
  closeProject: () => void;
  mutate: (fn: (tx: string) => Promise<MutationResponse>) => Promise<void>;
  recover: (choice: "reapply" | "discard") => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  restore: (snapshot: string) => Promise<void>;
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
  setSketchState: (
    state: Partial<Pick<SketchState, "constructionMode" | "polygonSides">>,
  ) => void;
  setSketchTool: (tool: SketchTool) => void;
  updateDraftSketch: (
    entities: SketchEntity[],
    constraints: SketchConstraint[],
  ) => SketchConstraint | null;
  solveDraft: (drag?: { pointId: string; x: number; y: number }) => void;
  commitDraftSketch: () => Promise<void>;
  finishSketch: () => Promise<void>;

  deleteSketchEntities: (entityIds: string[]) => Promise<void>;
  toggleSketchConstruction: (entityIds: string[]) => Promise<void>;
  trimSketchPieces: (targets: TrimTarget[]) => Promise<void>;
  insertSketchImport: (format: string, imported: SketchImport) => Promise<void>;

  addFeature: (feature: Feature) => Promise<void>;
  updateFeature: (fid: string, patch: Partial<Feature>) => Promise<void>;
  updateFeaturePreview: (fid: string, patch: Partial<Feature>) => Promise<void>;
  previewNewFeature: (feature: Feature) => Promise<void>;
  cancelPreview: () => Promise<void>;
  deleteFeature: (fid: string) => Promise<void>;
  suppressFeature: (fid: string, suppressed: boolean) => Promise<void>;
  renameFeature: (fid: string, name: string) => Promise<void>;
  renameProject: (name: string) => Promise<void>;
  rollTimeline: (position: number) => Promise<void>;
  setBodyMeta: (bodyId: string, patch: { name: string }) => Promise<void>;
  setVisible: (shown: Visibility) => Promise<void>;
  moveCamera: (camera: ViewCamera) => void;
}

export const isIdle = (s: Pick<State, "mode" | "active">) =>
  s.mode.name === "idle" && !s.active;

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
  error: string | null;
} = {
  seq: 0,
  pending: null,
  inFlight: null,
  session: null,
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

export function dialogFeatureId(active: Active | null): string | undefined {
  if (active?.id === "design.feature")
    return (
      active.state.editFeatureId ??
      (preview.session?.fresh ? preview.session.fid : undefined)
    );
}

export function previewedFeature(s: {
  active: Active | null;
  document: CadDocument | null;
}): Feature | undefined {
  const id = dialogFeatureId(s.active);
  return s.document?.features.find((f) => f.id === id);
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
      const after = await previewBase.bodiesAfter(m.document, fid);
      if (seq !== preview.seq) continue;
      previewBase.landAfter(fid, after);
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

let writing = 0;
let unsent: Array<(tx: string) => Promise<MutationResponse>> = [];
let abandoned: string[] = [];

function saveState(s: State): Pick<State, "saveState"> {
  return {
    saveState: s.recovery ? "unsaved" : writing > 0 ? "saving" : "saved",
  };
}

const inTurn = writeQueue((count) => {
  writing = count;
  useStore.setState(saveState);
});

async function saveView(
  projectId: string,
  change: (view: ProjectView) => ProjectView,
): Promise<void> {
  const next = change(useStore.getState().view);
  useStore.setState({ view: next });
  try {
    await inTurn(() => api.putView(projectId, next));
  } catch (e: any) {
    const conflict = e?.status === 409;
    if (conflict) cameraSave.dropCameraSave();
    const view = conflict
      ? await api.getView(projectId).catch(() => null)
      : null;
    if (useStore.getState().projectId === projectId)
      useStore.setState(view ? { view } : { error: e.message });
  }
}

const landed = (m: MutationResponse) => ({
  document: m.document,
  evaluation: m.evaluation,
  history: m.history ?? null,
  error: m.warning ?? null,
});

async function loadHistory(document: CadDocument): Promise<void> {
  try {
    const { entries, position } = await api.history(document.id);
    const [undo, redo] = [entries[position - 1], entries[position]];
    if (useStore.getState().document === document)
      useStore.setState({
        history: {
          canUndo: !!undo,
          canRedo: !!redo,
          undoLabel: undo?.label ?? null,
          redoLabel: redo?.label ?? null,
        },
      });
  } catch {
    return;
  }
}

async function reload(id: string): Promise<void> {
  previewBase.dropBase();
  const { document } = await api.getProject(id);
  const { active } = useStore.getState();
  const position = sketchEditingPosition(document, active);
  const evaluation = await api.evaluate(id, position);
  useStore.setState({
    document,
    evaluation,
    recovery: null,
    history: null,
    busy: false,
    ...historyEditingState(active, { document, evaluation }),
  });
  void loadHistory(document);
}

const kept = (id: string, e: Error): Promise<void> =>
  reload(id).catch(() => useStore.setState({ error: e.message, busy: false }));

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
  id: string,
  session: Session | null,
  patch: Partial<Feature>,
  plain: (tx: string) => Promise<MutationResponse>,
): Promise<void> {
  const { mutate } = useStore.getState();
  try {
    await mutate(session ? committing(id, session, patch, plain) : plain);
  } catch (e) {
    if (!useStore.getState().recovery) preview.session ??= session;
    else if (session?.staged) abandoned.push(session.tx);
    throw e;
  }
}

async function moveHistory(
  able: boolean | undefined,
  move: (projectId: string, position?: number) => Promise<MutationResponse>,
): Promise<void> {
  const { document, projectId, active, busy, recovery } = useStore.getState();
  if (busy || recovery || !projectId || !document || !able) return;
  useStore.setState({ busy: true });
  const position = sketchEditingPosition(document, active);
  try {
    const m = await inTurn(() =>
      move(projectId, position).catch((e) => {
        if (e?.status !== 400 || position === undefined) throw e;
        return move(projectId);
      }),
    );
    useStore.setState({
      ...landed(m),
      savedAt: Date.now(),
      busy: false,
      ...historyEditingState(active, m),
    });
  } catch (e: any) {
    if (e?.code === "kept") return kept(projectId, e);
    useStore.setState({ error: lost(e) ? null : e.message, busy: false });
  }
}

export const useStore = create<State>((set, get) => ({
  projectId: null,
  access: null,
  document: null,
  evaluation: null,
  view: emptyView(),
  busy: false,
  job: null,
  jobStartedAt: null,
  error: null,
  notSaved: null,
  saveState: "saved",
  savedAt: null,
  recovery: null,
  history: null,
  mode: { name: "idle" },
  dialogParams: {},
  pickInput: null,
  selection: [],
  hover: null,
  draftSketch: null,
  active: null,

  async openProject(id, path = projectPath(id)) {
    cameraSave.dropCameraSave();
    void get().cancelPreview();
    api.forgetJob?.();
    set({
      active: null,
      busy: true,
      error: null,
      job: null,
      jobStartedAt: null,
    });
    try {
      const [{ document, access }, view] = await Promise.all([
        api.getProject(id),
        api.getView(id),
      ]);
      const evaluation = await api.evaluate(id);
      set({
        projectId: id,
        access,
        document,
        evaluation,
        view,
        history: null,
        selection: [],
        active: null,
        mode: { name: "idle" },
        draftSketch: null,
        dialogParams: {},
        recovery: null,
        saveState: "saved",
        savedAt: null,
        busy: false,
      });
      [unsent, abandoned] = [[], []];
      showPath(path);
      void loadHistory(document);
    } catch (e: any) {
      if (e?.status === 401) return set({ busy: false });
      window.history.replaceState(null, "", "/");
      get().closeProject();
      set({ error: e.message });
    }
  },
  closeProject() {
    cameraSave.flushCameraSave();
    void get().cancelPreview();
    api.forgetJob?.();
    [unsent, abandoned] = [[], []];
    api.forgetMeshes();
    set({
      recovery: null,
      saveState: "saved",
      savedAt: null,
      error: null,
      projectId: null,
      active: null,
      access: null,
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

  async mutate(fn) {
    if (!get().document) return;
    set({ busy: true });
    await endPreviews();
    const tx = crypto.randomUUID();
    return inTurn(async () => {
      const { document, recovery } = get();
      if (!document) return;
      if (recovery) {
        unsent.push(fn);
        set({ busy: false });
        throw new Error(recovery.message);
      }
      set({ busy: true, error: null });
      try {
        const m = await fn(tx);
        previewBase.dropBase();
        set({ ...landed(m), savedAt: Date.now(), busy: false });
      } catch (e: any) {
        if (e?.code === "kept") return await kept(document.id, e);
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
    set({ busy: true, error: null });
    const reloaded = await inTurn(async () => {
      try {
        for (const tx of abandoned.splice(0))
          await api.abortPreview(document.id, tx).catch(() => null);
        await reload(document.id);
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
    previewBase.holdBase(fid, evaluation);
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
    previewBase.dropBase();
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
          ...(m && landed(m)),
          busy: false,
        });
    } catch (e: any) {
      if (current()) set({ error: lost(e) ? null : e.message, busy: false });
    }
  },

  undo: () => moveHistory(get().history?.canUndo, api.undo),
  redo: () => moveHistory(get().history?.canRedo, api.redo),
  restore: (snapshot) =>
    moveHistory(true, (projectId) => api.restoreHistory(projectId, snapshot)),

  setError: (e) => set({ error: e }),
  async cancelJob() {
    try {
      await api.cancelJob();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  setSelection: (s) => set({ selection: s }),
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
    set({ mode: m, dialogParams: {}, pickInput: null, active: null });
  },
  cancelDialog() {
    const before = selectionBeforeCommand(get());
    get().setMode({ name: "idle" });
    set({ selection: before });
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
    const created = get().document!.features.find(
      (f) => f.id === feature.id,
    ) as SketchFeature;
    set({
      active: {
        id: "design.sketch",
        state: sketchState(feature.id, "line"),
      },
      draftSketch: JSON.parse(JSON.stringify(created)),
      selection: [],
    });
  },

  async editSketch(sketchId) {
    if (get().busy) return;
    const active = get().active;
    if (active?.id === "design.sketch") {
      if (active.state.sketchId === sketchId) return;
      await get().finishSketch();
      if (get().active?.id === "design.sketch") return;
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
        active: {
          id: "design.sketch",
          state: sketchState(sketchId, "select"),
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

  setSketchState(state) {
    const active = get().active;
    if (active?.id !== "design.sketch") return;
    set({ active: { ...active, state: { ...active.state, ...state } } });
  },
  setSketchTool(tool) {
    const { active } = get();
    if (active?.id !== "design.sketch") return;
    set({
      active: { ...active, state: { ...active.state, tool } },
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
    if (!draftSketch) return null;
    try {
      set({
        draftSketch: {
          ...draftSketch,
          entities: editedEntities(draftSketch.constraints, {
            entities,
            constraints,
          }),
          constraints,
        },
      });
      return null;
    } catch (e) {
      if (!(e instanceof OverConstrainedError)) throw e;
      set({ error: e.message });
      return e.constraint;
    }
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
        sketchEditingPosition(document, get().active),
        tx,
      ),
    );
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
    if (get().busy || get().active?.id !== "design.sketch") return;
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
        active: null,
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

  async trimSketchPieces(targets) {
    const { draftSketch, busy } = get();
    if (!draftSketch || busy || !targets.length) return;
    const result = trimSketchPieces(
      draftSketch.entities,
      draftSketch.constraints,
      targets,
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
    await saveDialog(document.id, take(true), featurePatch(feature), plain);
  },

  async updateFeature(fid, patch) {
    const { document } = get();
    if (!document) return;
    const plain = (tx: string) =>
      api.updateFeature(
        document.id,
        fid,
        patch,
        sketchEditingPosition(document, get().active),
        tx,
      );
    await saveDialog(document.id, take(false, fid), patch, plain);
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
      const current = get().document;
      if (current && current.id === renamed.id) {
        set({ document: { ...current, name: renamed.name } });
      }
    } catch (e: any) {
      if (!lost(e)) set({ error: e.message });
    }
  },

  async rollTimeline(position) {
    if (get().active?.id === "design.sketch" || get().busy) return;
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
    const { projectId } = get();
    if (projectId) await saveView(projectId, (view) => withShown(view, shown));
  },

  moveCamera(camera) {
    cameraSave.dropCameraSave();
    const { projectId } = get();
    if (projectId)
      cameraSave.scheduleCameraSave(
        () => void saveView(projectId, (view) => ({ ...view, camera })),
      );
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
