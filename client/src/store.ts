import { create } from "zustand";
import type { Active } from "./commands/active";
import type {
  CadDocument,
  EvaluateResult,
  Feature,
  HistoryStatus,
  OpenedProject,
  ProjectView,
  SketchFeature,
  ViewCamera,
  Visibility,
} from "@rockett/shared";
import { emptyView, withShown } from "@rockett/shared";
import { api, type MutationResponse } from "./api";
import * as cameraSave from "./cameraSave";
import { projectIdFromPath, projectPath, showPath } from "./paths";
import * as previewBase from "./previewBase";
export { previewBodies } from "./previewBase";
import { recoveryFor, writeQueue, type Recovery } from "./saving";
import {
  historyEditingState,
  sketchActions,
  sketchEditingPosition,
  type SketchActions,
} from "./sketchEditing";
import { sketchEdits, type SketchEdits } from "./sketchEdits";

import {
  selectionBeforeCommand,
  selectionKey,
  type Selection,
} from "./selection/kinds";
export { selectionKey, type Selection } from "./selection/kinds";

export type { SketchTool } from "./commands/sketch";

export interface State extends SketchActions, SketchEdits {
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

  clearActive: () => void;
  cancelDialog: () => void;
  setPickInput: (key: string) => void;

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

export const isIdle = (s: Pick<State, "active">) => !s.active;

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
        draftSketch: null,
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
      history: null,
      draftSketch: null,
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

  clearActive() {
    set({ pickInput: null, active: null });
  },
  cancelDialog() {
    const before = selectionBeforeCommand(get());
    get().clearActive();
    set({ selection: before });
  },
  setPickInput: (key) => set({ pickInput: key }),

  ...sketchActions(set, get),
  ...sketchEdits(set, get),

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
