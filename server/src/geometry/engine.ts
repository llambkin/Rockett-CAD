/**
 * Regeneration engine.
 *
 * Evaluates a document's feature timeline in order, up to the timeline
 * marker, maintaining per-feature snapshots so an edit to feature k only
 * re-evaluates features k..end (the brief's "retain valid cached state,
 * invalidate downstream" requirement).
 *
 * A failed feature is recorded in the result with an actionable error and
 * evaluation continues with the pre-failure state, so downstream features
 * that don't depend on it still build (they may fail themselves, which is
 * also recorded — never silently discarded).
 */

import type {
  BodyPayload,
  CadDocument,
  ConstructionPlanePayload,
  EvaluateResult,
  FeatureStatus,
  SketchPayload,
} from "@rockett/shared";
import {
  cloneState,
  emptyState,
  evaluateFeature,
  type EvalState,
} from "./features.js";
import { tessellateBody } from "./tessellate.js";
import { shapeHash } from "./kernel.js";

interface Snapshot {
  /** JSON of the feature this snapshot is the result of (cache key). */
  featureKey: string;
  state: EvalState;
  statuses: FeatureStatus[];
}

/** Cache key for a feature: its JSON minus display-only fields, so hiding a
 * sketch in the viewport doesn't re-evaluate the timeline after it. */
function featureKey(feature: CadDocument["features"][number]): string {
  const { visible: _visible, ...geometric } = feature as any;
  return JSON.stringify(geometric);
}

class DocumentEngine {
  private snapshots: Snapshot[] = [];
  private tessCache = new Map<string, BodyPayload>();

  evaluate(doc: CadDocument, position?: number): EvaluateResult {
    const t0 = performance.now();
    const upTo = Math.min(
      position ?? doc.timelinePosition,
      doc.features.length,
    );

    // Drop snapshots from the first stale feature on. Valid snapshots past
    // upTo stay, so a rewind or stateAt query doesn't discard later work.
    let valid = 0;
    while (
      valid < this.snapshots.length &&
      valid < doc.features.length &&
      this.snapshots[valid].featureKey === featureKey(doc.features[valid])
    ) {
      valid++;
    }
    this.snapshots.length = valid;
    const start = Math.min(valid, upTo);

    let state: EvalState =
      start === 0 ? emptyState() : cloneState(this.snapshots[start - 1].state);
    let statuses: FeatureStatus[] =
      start === 0 ? [] : [...this.snapshots[start - 1].statuses];

    for (let i = start; i < upTo; i++) {
      const feature = doc.features[i];
      const next = cloneState(state);
      let status: FeatureStatus;
      if (feature.suppressed) {
        status = { featureId: feature.id, status: "suppressed" };
      } else {
        try {
          evaluateFeature(next, feature, doc);
          status = { featureId: feature.id, status: "ok" };
        } catch (err: any) {
          status = {
            featureId: feature.id,
            status: "error",
            error: err?.message ?? String(err),
          };
          // keep pre-failure state
          next.bodies = new Map(state.bodies);
          next.sketches = new Map(state.sketches);
          next.planes = new Map(state.planes);
        }
      }
      statuses = [...statuses, status];
      this.snapshots.push({
        featureKey: featureKey(feature),
        state: next,
        statuses,
      });
      state = next;
    }

    // Rolled-back features
    for (let i = upTo; i < doc.features.length; i++) {
      statuses = [
        ...statuses,
        { featureId: doc.features[i].id, status: "rolledBack" },
      ];
    }

    // --- payloads ---
    const bodies: BodyPayload[] = [];
    for (const body of state.bodies.values()) {
      const meta = doc.bodyMeta[body.bodyId] ?? {
        name: body.bodyId,
        visible: true,
      };
      const cacheKey = `${body.bodyId}:${shapeHash(body.shape)}:${meta.name}:${meta.visible}`;
      let payload = this.tessCache.get(cacheKey);
      if (!payload) {
        payload = tessellateBody(body, meta);
        this.tessCache.set(cacheKey, payload);
        // basic cache size control
        if (this.tessCache.size > 64) {
          const firstKey = this.tessCache.keys().next().value;
          if (firstKey) this.tessCache.delete(firstKey);
        }
      }
      bodies.push(payload);
    }

    const sketches: SketchPayload[] = [];
    for (const sk of state.sketches.values()) {
      sketches.push({
        featureId: sk.featureId,
        frame: sk.frame,
        entities: sk.entities,
        solveStatus: sk.solveStatus,
        dof: sk.dof,
        profiles: sk.profiles,
      });
    }

    const planes: ConstructionPlanePayload[] = [];
    for (const [featureId, p] of state.planes) {
      planes.push({ featureId, frame: p.frame, size: p.size });
    }

    return {
      bodies,
      featureStatuses: statuses,
      sketches,
      planes,
      kernelMs: Math.round(performance.now() - t0),
    };
  }

  /** Access the evaluated state at the current cache tip (for measure/export). */
  stateAt(doc: CadDocument, position?: number): EvalState {
    this.evaluate(doc, position);
    const upTo = Math.min(
      position ?? doc.timelinePosition,
      doc.features.length,
    );
    if (upTo === 0) return emptyState();
    return this.snapshots[upTo - 1].state;
  }

  invalidate(): void {
    this.snapshots = [];
    this.tessCache.clear();
  }
}

const engines = new Map<string, DocumentEngine>();

export function engineFor(docId: string): DocumentEngine {
  let e = engines.get(docId);
  if (!e) {
    e = new DocumentEngine();
    engines.set(docId, e);
  }
  return e;
}

export function dropEngine(docId: string): void {
  engines.delete(docId);
}

export type { DocumentEngine };
