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
  CadDocument,
  EvaluateResult,
  Feature,
  MeasureResult,
  PlaneRef,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchImport,
} from "@rockett/shared";
import {
  newId,
  solveSketch,
  createSketchOffset,
  editSketchOffset,
} from "@rockett/shared";
import { api, type MutationResponse } from "./api";

// ---------------------------------------------------------------------------

export type Selection =
  | { kind: "body"; bodyId: string }
  | { kind: "face"; bodyId: string; faceName: string }
  | { kind: "edge"; bodyId: string; edgeName: string }
  | { kind: "vertex"; bodyId: string; vertexName: string }
  | { kind: "plane"; ref: PlaneRef; label: string }
  | { kind: "profile"; sketchId: string; profileId: string }
  | { kind: "sketchEntity"; sketchId: string; entityId: string }
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

/** All entity ids a constraint references. */
export function constraintEntityRefs(c: SketchConstraint): string[] {
  const anyC = c as any;
  return (
    [anyC.a, anyC.b, anyC.line, anyC.point, anyC.circle, anyC.entity] as (
      string | undefined
    )[]
  ).filter((x): x is string => typeof x === "string");
}

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
  busy: boolean;
  error: string | null;

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
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  applyMutation: (m: MutationResponse) => void;
  mutate: (fn: () => Promise<MutationResponse>) => Promise<void>;
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
  insertSketchImport: (format: string, imported: SketchImport) => Promise<void>;

  addFeature: (feature: Feature) => Promise<void>;
  updateFeature: (fid: string, patch: Partial<Feature>) => Promise<void>;
  /** Live-preview edit: updates the feature WITHOUT pushing an undo entry. */
  updateFeaturePreview: (fid: string, patch: Partial<Feature>) => Promise<void>;
  /** Revert any live-preview edits made since the dialog opened. */
  cancelPreview: () => Promise<void>;
  deleteFeature: (fid: string) => Promise<void>;
  suppressFeature: (fid: string, suppressed: boolean) => Promise<void>;
  renameFeature: (fid: string, name: string) => Promise<void>;
  /** Rename the open project (display only — no regeneration, not an undo step). */
  renameProject: (name: string) => Promise<void>;
  rollTimeline: (position: number) => Promise<void>;
  setBodyMeta: (
    bodyId: string,
    patch: { name?: string; visible?: boolean },
  ) => Promise<void>;

  runMeasure: () => Promise<void>;
}

const preview: {
  seq: number;
  pending: { fid: string; patch: Partial<Feature> } | null;
  inFlight: Promise<void> | null;
} = { seq: 0, pending: null, inFlight: null };

async function sendPreviews(): Promise<void> {
  while (preview.pending) {
    const { fid, patch } = preview.pending;
    preview.pending = null;
    const seq = preview.seq;
    const { document } = useStore.getState();
    if (!document) break;
    try {
      const m = await api.updateFeature(document.id, fid, patch);
      if (seq === preview.seq)
        useStore.setState({ document: m.document, evaluation: m.evaluation });
    } catch (e: any) {
      if (seq === preview.seq) useStore.setState({ error: e.message });
    }
  }
  preview.inFlight = null;
}

function endPreviews(): Promise<void> | null {
  preview.seq++;
  preview.pending = null;
  return preview.inFlight;
}

function projectPath(id: string): string {
  return `/projects/${encodeURIComponent(id)}`;
}

function projectIdFromPath(path: string): string | null {
  const segment = /^\/projects\/([^/]+)\/?$/.exec(path)?.[1];
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function showPath(path: string): void {
  if (window.location.pathname !== path)
    window.history.pushState(null, "", path);
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
  busy: false,
  error: null,
  mode: { name: "idle" },
  dialogParams: {},
  selection: [],
  hover: null,
  draftSketch: null,
  measureResult: null,
  undoStack: [],
  redoStack: [],
  previewBaseline: null,

  async openProject(id) {
    set({ busy: true, error: null });
    try {
      const { document } = await api.getProject(id);
      const evaluation = await api.evaluate(id);
      set({
        projectId: id,
        document,
        evaluation,
        undoStack: [],
        redoStack: [],
        selection: [],
        mode: { name: "idle" },
        draftSketch: null,
        dialogParams: {},
        busy: false,
      });
      showPath(projectPath(id));
    } catch (e: any) {
      window.history.replaceState(null, "", "/");
      get().closeProject();
      set({ error: e.message });
    }
  },

  closeProject() {
    showPath("/");
    set({
      error: null,
      projectId: null,
      document: null,
      evaluation: null,
      selection: [],
      mode: { name: "idle" },
      undoStack: [],
      redoStack: [],
      draftSketch: null,
      dialogParams: {},
      busy: false,
    });
  },

  applyMutation(m) {
    set({ document: m.document, evaluation: m.evaluation });
  },

  async mutate(fn) {
    const { document, previewBaseline } = get();
    if (!document) return;
    // If live previews already changed the document, the undo entry for this
    // commit is the state from before the previews started.
    const snapshot = previewBaseline ?? JSON.parse(JSON.stringify(document));
    set({ busy: true, error: null });
    try {
      await endPreviews();
      const m = await fn();
      set((s) => ({
        document: m.document,
        evaluation: m.evaluation,
        undoStack: [...s.undoStack.slice(-49), snapshot],
        redoStack: [],
        previewBaseline: null,
        busy: false,
      }));
    } catch (e: any) {
      set({ error: e.message, busy: false });
      throw e;
    }
  },

  async updateFeaturePreview(fid, patch) {
    const { document, previewBaseline } = get();
    if (!document) return;
    if (!previewBaseline) {
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

  async cancelPreview() {
    const { previewBaseline, projectId } = get();
    const settling = endPreviews();
    if (!previewBaseline || !projectId) {
      set({ previewBaseline: null });
      return;
    }
    set({ busy: true });
    try {
      await settling;
      const m = await api.replaceDocument(projectId, previewBaseline);
      set({
        document: m.document,
        evaluation: m.evaluation,
        previewBaseline: null,
        busy: false,
      });
    } catch (e: any) {
      set({ error: e.message, previewBaseline: null, busy: false });
    }
  },

  async undo() {
    const { undoStack, document, projectId, mode, busy } = get();
    if (busy || !projectId || !document || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1]!;
    set({ busy: true });
    try {
      const m = await api.replaceDocument(
        projectId,
        prev,
        sketchEditingPosition(prev, mode),
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
      set({ error: e.message, busy: false });
    }
  },

  async redo() {
    const { redoStack, document, projectId, mode, busy } = get();
    if (busy || !projectId || !document || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    set({ busy: true });
    try {
      const m = await api.replaceDocument(
        projectId,
        next,
        sketchEditingPosition(next, mode),
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
      set({ error: e.message, busy: false });
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
    await get().mutate(() => api.addFeature(document.id, feature));
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
      const { document: renamed } = await api.renameProject(
        document.id,
        trimmed,
      );
      // only the name changed server-side; keep whatever else is in the store
      const current = get().document;
      if (current && current.id === renamed.id) {
        set({ document: { ...current, name: renamed.name } });
      }
    } catch (e: any) {
      set({ error: e.message });
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
