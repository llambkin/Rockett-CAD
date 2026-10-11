import {
  bodyMadeBy,
  derivedBodyId,
  featureRefs,
  Placement,
  type Feature,
  type MoveFeature,
  type SketchFeature,
} from "@rockett/shared";
import { type EvalContext } from "./featureKinds.js";
import { registerBodySolids, type EvalState } from "./featureState.js";
import { resolveAxis } from "./features.js";
import { acquire, kernelCall, placementToTrsf, transformOp } from "./kernel.js";
import { transformCopy } from "./mesh.js";
import { finalizeNames, patternPrefix, transformNames } from "./naming.js";

export function evalMove(
  { state, earlier }: EvalContext,
  f: MoveFeature,
): void {
  if (f.bodies.length === 0)
    throw new Error("select at least one body to move");
  const axis = resolveAxis(state, f.axis);
  const placement = Placement.compose(
    Placement.fromTranslation(f.translation),
    Placement.fromAxisAngle(
      axis.direction,
      (f.angle * Math.PI) / 180,
      axis.origin,
    ),
  );
  kernelCall("move", () => {
    for (const [j, bodyId] of f.bodies.entries()) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      const trsf = placementToTrsf(placement);
      if (!f.copy) {
        const tr = transformOp(body.shape, trsf);
        const moved = acquire(tr.Shape());
        registerBodySolids(state, bodyId, moved, transformNames(tr, body, ""));
        continue;
      }
      const tr = transformCopy(body.shape, trsf);
      const copy = acquire(tr.Shape());
      const names = transformNames(tr, body, patternPrefix(1, f.id));
      registerBodySolids(
        state,
        derivedBodyId(f.id, j + 1),
        copy,
        finalizeNames(copy, names, f.id),
      );
    }
  });
  if (!f.copy) carrySketches(state, earlier, f.bodies, placement);
}

function carrySketches(
  state: EvalState,
  earlier: Feature[],
  bodies: string[],
  placement: Placement,
) {
  const movedIds = new Set(bodies);
  const createdBy = (g: Feature) =>
    [...movedIds].some((id) => bodyMadeBy(g.id, id));
  for (const [skId, sk] of state.sketches) {
    const feat = earlier.find((g) => g.id === skId && g.type === "sketch") as
      SketchFeature | undefined;
    if (!feat) continue;
    const follows =
      (feat.plane.kind === "face" && movedIds.has(feat.plane.face.bodyId)) ||
      earlier.some(
        (g) =>
          createdBy(g) &&
          featureRefs(g).some(
            (ref) =>
              (ref.kind === "profile" && ref.profile.sketchId === skId) ||
              (ref.kind === "sketch" && ref.sketch === skId),
          ),
      );
    if (follows)
      state.sketches.set(skId, {
        ...sk,
        frame: Placement.applyToFrame(placement, sk.frame),
      });
  }
}
