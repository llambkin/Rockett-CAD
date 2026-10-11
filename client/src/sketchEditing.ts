import type { StoreApi } from "zustand";
import type {
  CadDocument,
  Feature,
  ParameterBinding,
  PlaneRef,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
} from "@rockett/shared";
import {
  movedBindings,
  ROUTES,
  newId,
  resolvedFeatureIn,
  solveSketch,
  editedEntities,
  OverConstrainedError,
} from "@rockett/shared";
import { api, send, type MutationResponse } from "./api";
import type { Active } from "./commands/active";
import {
  sketchState,
  type SketchState,
  type SketchTool,
} from "./commands/sketch";
import type { Selection } from "./selection/kinds";
import type { State } from "./store";
import { committedLinks } from "./previewBase";

export function historyEditingState(
  active: Active | null,
  m: MutationResponse,
): {
  draftSketch: SketchFeature | null;
  selection: Selection[];
  active: Active | null;
} {
  const cleared = { active: null, selection: [] };
  if (active?.id === "design.sketch") {
    const feature = m.document.features.find(
      (f) => f.id === active.state.sketchId,
    );
    const solved = m.evaluation.sketches.find(
      (sk) => sk.featureId === active.state.sketchId,
    );
    if (feature?.type === "sketch" && solved)
      return {
        ...cleared,
        active: { ...active, state: { ...active.state, tool: "select" } },
        draftSketch: JSON.parse(
          JSON.stringify({
            ...resolvedFeatureIn(m.document, feature),
            entities: solved.entities,
          }),
        ),
      };
  }
  return { ...cleared, draftSketch: null };
}

export function sketchEditingPosition(
  document: CadDocument,
  active: Active | null,
): number | undefined {
  if (active?.id !== "design.sketch") return undefined;
  const index = document.features.findIndex(
    (f) => f.id === active.state.sketchId && f.type === "sketch",
  );
  return index < 0 ? undefined : index + 1;
}

const driven = (c: SketchConstraint) => "driven" in c && c.driven === true;

export type SketchLinks = Readonly<Record<string, string | null>>;

function sketchBindings(
  doc: CadDocument,
  saved: SketchFeature,
  draft: SketchFeature,
  links: SketchLinks = {},
): ParameterBinding[] | null {
  const at = new Map(
    draft.constraints.map((c, i) => [`/constraints/${i}/value`, c]),
  );
  const stored = committedLinks(doc);
  const next = movedBindings(stored, saved, draft).flatMap((b) => {
    const c = b.featureId === draft.id ? at.get(b.path) : undefined;
    if (!c) return [b];
    const link = links[c.id];
    if (driven(c) || link === null) return [];
    return [link === undefined ? b : { ...b, expression: link }];
  });
  for (const [path, c] of at) {
    const expression = links[c.id];
    if (
      typeof expression === "string" &&
      !driven(c) &&
      !next.some((b) => b.featureId === draft.id && b.path === path)
    )
      next.push({ featureId: draft.id, path, expression });
  }
  return JSON.stringify(next) === JSON.stringify(stored) ? null : next;
}

export interface SketchActions {
  startSketchOnPlane: (ref: PlaneRef, boundary?: Boundary) => Promise<void>;
  editSketch: (sketchId: string) => Promise<void>;
  setSketchState: (
    state: Partial<Omit<SketchState, "sketchId" | "tool">>,
  ) => void;
  setSketchTool: (tool: SketchTool) => void;
  updateDraftSketch: (
    entities: SketchEntity[],
    constraints: SketchConstraint[],
  ) => SketchConstraint | null;
  inferDraftSketch: (
    entities: SketchEntity[],
    constraints: SketchConstraint[],
  ) => void;
  solveDraft: (drag?: { pointId: string; x: number; y: number }) => void;
  commitDraftSketch: (links?: SketchLinks) => Promise<void>;
  finishSketch: () => Promise<void>;
}

type Boundary = "copy" | "empty";

const addSketch = (
  id: string,
  feature: SketchFeature,
  tx: string,
  boundary: Boundary,
) =>
  boundary === "copy"
    ? api.addFeature(id, feature, tx)
    : send(
        ROUTES.addFeature,
        { id },
        { body: { feature, emptySketch: true }, tx },
      );

export function sketchActions(
  set: StoreApi<State>["setState"],
  get: StoreApi<State>["getState"],
): SketchActions {
  return {
    async startSketchOnPlane(ref, boundary = "copy") {
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
      await get().mutate((tx) => addSketch(document.id, feature, tx, boundary));
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
          active: {
            id: "design.sketch",
            state: sketchState(sketchId, "select"),
          },
          draftSketch: {
            ...JSON.parse(JSON.stringify(resolvedFeatureIn(document, feature))),
            entities: JSON.parse(JSON.stringify(solved.entities)),
          },
          selection: [],
        });
      } catch (e: any) {
        if (get().projectId === document.id)
          set({ busy: false, error: e.message });
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
        active: {
          ...active,
          state: {
            ...active.state,
            tool,
            ...(tool === "offset" && {
              offsetManualSelection: false,
              offsetEditId: null,
            }),
          },
        },
        selection: [],
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

    inferDraftSketch(entities, constraints) {
      const had = new Set(get().draftSketch?.constraints.map((c) => c.id));
      let next = constraints;
      for (let left = constraints.length; left >= 0; left--) {
        const refused = get().updateDraftSketch(entities, next);
        if (!refused || "value" in refused || had.has(refused.id)) return;
        set({ error: null });
        next = next.filter((c) => c !== refused);
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

    async commitDraftSketch(links) {
      const { draftSketch, document } = get();
      if (!draftSketch || !document) return;
      const saved = document.features.find((f) => f.id === draftSketch.id);
      const sketch = saved?.type === "sketch" ? saved : null;
      const parameterBindings =
        sketch && sketchBindings(document, sketch, draftSketch, links);
      const shown = sketch && resolvedFeatureIn(document, sketch);
      if (
        shown &&
        !parameterBindings &&
        JSON.stringify([
          shown.entities,
          shown.constraints,
          shown.offsets ?? [],
        ]) ===
          JSON.stringify([
            draftSketch.entities,
            draftSketch.constraints,
            draftSketch.offsets ?? [],
          ])
      )
        return;
      const patch = {
        entities: draftSketch.entities,
        constraints: draftSketch.constraints,
        offsets: draftSketch.offsets,
      } as Partial<Feature>;
      const position = sketchEditingPosition(document, get().active);
      await get().mutate((tx) =>
        parameterBindings
          ? api.updateFeature(
              document.id,
              draftSketch.id,
              patch,
              position,
              tx,
              undefined,
              parameterBindings,
            )
          : api.updateFeature(document.id, draftSketch.id, patch, position, tx),
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
          draftSketch: null,
          selection: [],
        });
      } catch (e: any) {
        set({ busy: false, error: e.message });
      }
    },
  };
}
