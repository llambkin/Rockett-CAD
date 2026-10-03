import { createRegistry, type Feature } from "@rockett/shared";
import {
  cloneState,
  unrecorded,
  type EvalState,
  type FeatureOutcome,
} from "./featureState.js";
import { scoped } from "./kernel.js";
import { type ShapeMap, trackShapeMaps } from "./shapeMap.js";
import type { Sources } from "./importers.js";

export interface EvalContext {
  state: EvalState;
  earlier: Feature[];
  index: number;
  sources: Sources;
}

export interface FeatureKind<F extends Feature = Feature> {
  type: string;
  evaluate(ctx: EvalContext, f: F): FeatureOutcome | void;
}

export const featureKinds = createRegistry<FeatureKind>(
  "feature kind",
  (kind) => kind.type,
);

export const registerFeatureKind = featureKinds.register;
export const featureKind = featureKinds.get;

export function evaluateFeature(
  state: EvalState,
  feature: Feature,
  earlier: Feature[],
  sources: Sources = new Map(),
): FeatureOutcome | void {
  const kind = featureKind(feature.type);
  if (!kind) throw new Error(`unknown feature type ${feature.type}`);
  const previous = { ...state };
  Object.assign(state, cloneState(state));
  try {
    return scoped((own) => {
      const made: ShapeMap<unknown>[] = [];
      let completed = false;
      try {
        const outcome = trackShapeMaps(made, () =>
          kind.evaluate(
            { state, earlier, index: earlier.length, sources },
            feature,
          ),
        );
        for (const body of unrecorded(state.bodies)) own.keep(body.shape);
        completed = true;
        return outcome;
      } finally {
        const held = new Set<ShapeMap<unknown>>(
          [...unrecorded(state.bodies)].map((body) => body.names),
        );
        for (const map of made) {
          const cleanup = own({ delete: () => map.release() });
          if (completed && held.has(map)) own.keep(cleanup);
        }
      }
    });
  } catch (error) {
    Object.assign(state, previous);
    if (!("hidden" in previous)) delete state.hidden;
    throw error;
  }
}
