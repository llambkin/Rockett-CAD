import type { StoreApi } from "zustand";
import type { SketchEntity, SketchImport, TrimTarget } from "@rockett/shared";
import {
  createSketchOffset,
  editSketchOffset,
  constraintEntityRefs,
  entityPointIds,
  solveSketch,
  trimSketchPieces,
  withGroups,
} from "@rockett/shared";
import type { State } from "./store";

export interface SketchEdits {
  createOffset: (
    ids: string[],
    distance: number,
    autoChain: boolean,
    joinTolerance: number,
  ) => Promise<void>;
  editOffset: (id: string, distance: number) => Promise<void>;
  deleteSketchEntities: (entityIds: string[]) => Promise<void>;
  toggleSketchConstruction: (entityIds: string[]) => Promise<void>;
  trimSketchPieces: (targets: TrimTarget[]) => Promise<void>;
  insertSketchImport: (format: string, imported: SketchImport) => Promise<void>;
}

export function sketchEdits(
  set: StoreApi<State>["setState"],
  get: StoreApi<State>["getState"],
): SketchEdits {
  return {
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

    async deleteSketchEntities(entityIds) {
      const { draftSketch } = get();
      if (!draftSketch || entityIds.length === 0) return;
      const idSet = withGroups(draftSketch.entities, entityIds);

      const gone = (e: SketchEntity) =>
        idSet.has(e.id) || entityPointIds(e).some((id) => idSet.has(id));
      const deletedCurvePoints = new Set(
        draftSketch.entities.filter(gone).flatMap(entityPointIds),
      );
      let entities = draftSketch.entities.filter((e) => !gone(e));
      const stillUsed = new Set(entities.flatMap(entityPointIds));
      entities = entities.filter(
        (e) =>
          e.kind !== "point" ||
          stillUsed.has(e.id) ||
          !deletedCurvePoints.has(e.id),
      );
      const drivenPoints = new Set(
        entities.flatMap((e) =>
          e.kind !== "point" && e.projection ? entityPointIds(e) : [],
        ),
      );
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
      get().inferDraftSketch(result.entities, result.constraints);
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
            `This ${format} file has no lines, arcs, circles, ellipses, splines or points to insert. ${skipped}`.trim(),
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
  };
}
