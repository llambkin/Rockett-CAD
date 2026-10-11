import {
  createRegistry,
  featureModule,
  newerFeature,
  type Feature,
  type ResolvedFeatureInputs,
} from "@rockett/shared";
import {
  cloneState,
  unrecorded,
  type EvalState,
  type FeatureOutcome,
} from "./featureState.js";
import { scoped } from "./kernel.js";
import { type ShapeMap, trackShapeMaps } from "./shapeMap.js";
import type { Sources } from "./importers.js";
import { heldParts } from "./meshBody.js";

export interface EvalContext {
  state: EvalState;
  earlier: Feature[];
  index: number;
  sources: Sources;
  inputs?: ResolvedFeatureInputs;
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
  inputs?: ResolvedFeatureInputs,
): FeatureOutcome | void {
  const kind = featureKind(feature.type);
  if (!kind) {
    const missing = featureModule(feature.type);
    throw new Error(
      missing
        ? `Requires module ${missing}`
        : `unknown feature type ${feature.type}`,
    );
  }
  const newer = newerFeature(feature);
  if (newer) throw new Error(newer);
  const previous = { ...state };
  Object.assign(state, cloneState(state));
  try {
    return scoped((own) => {
      const made: ShapeMap<unknown>[] = [];
      let completed = false;
      try {
        const outcome = trackShapeMaps(made, () =>
          kind.evaluate(
            {
              state,
              earlier,
              index: earlier.length,
              sources,
              ...(inputs && { inputs }),
            },
            feature,
          ),
        );
        for (const body of unrecorded(state.bodies))
          if (!body.mesh) own.keep(body.shape);
        completed = true;
        return outcome;
      } finally {
        const held = new Set<ShapeMap<unknown>>(
          [...unrecorded(state.bodies)].flatMap(heldParts).map((p) => p.names),
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
