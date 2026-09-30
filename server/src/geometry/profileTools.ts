import {
  findProfile,
  type FaceRef,
  type ProfileRef,
  type Vec3,
} from "@rockett/shared";
import {
  registerBodySolids,
  registerPieces,
  type EvalState,
  type EvaluatedSketch,
  type ToolResult,
  type FeatureOutcome,
} from "./featureState.js";
import {
  unifyTool,
  fuseNamed,
  applyToolOperation,
  subtractSketchRegionsFromFace,
} from "./boolean.js";
import { planarFacePlane, solids } from "./kernel.js";
import { findFace } from "./naming.js";
import { buildProfileFace, type ProfileFace } from "./sketchGeom.js";

export function resolveProfiles(
  state: EvalState,
  refs: ProfileRef[],
): { faces: ProfileFace[]; sketch: EvaluatedSketch } {
  if (refs.length === 0) throw new Error("no profiles selected");
  const sketch = state.sketches.get(refs[0]!.sketchId);
  if (!sketch) throw new Error(`sketch ${refs[0]!.sketchId} not found`);
  const out: ProfileFace[] = [];
  for (const ref of refs) {
    const s = state.sketches.get(ref.sketchId);
    if (!s) throw new Error(`sketch ${ref.sketchId} not found`);
    const profile = findProfile(s, ref.profileId);
    if (!profile) {
      throw new Error(
        `profile ${ref.profileId} no longer exists in ${ref.sketchId}: the sketch region may have changed`,
      );
    }
    out.push(buildProfileFace(profile, s.entities, s.frame));
  }
  return { faces: out, sketch };
}
function registerNewBodies(
  state: EvalState,
  featureId: string,
  tools: ToolResult[],
  regions: ProfileFace[],
): void {
  const unified = tools.map((t) => unifyTool(t, featureId));

  if (unified[0]?.names.version === 2) {
    registerPieces(
      state,
      `b:${featureId}`,
      unified.flatMap((u, i) =>
        solids(u.shape).map((shape) => ({
          shape,
          names: u.names,
          region: regions[i]!.profileId,
        })),
      ),
    );
    return;
  }
  unified.forEach((u, i) =>
    registerBodySolids(
      state,
      i === 0 ? `b:${featureId}` : `b:${featureId}:${i + 1}`,
      u.shape,
      u.names,
    ),
  );
}
export function faceProfile(
  state: EvalState,
  ref: FaceRef,
): { pf: ProfileFace; n: Vec3 } {
  const body = state.bodies.get(ref.bodyId);
  if (!body) throw new Error(`body ${ref.bodyId} no longer exists`);
  const face = findFace(body, ref.faceName);
  if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
  const plane = planarFacePlane(face);
  if (!plane) throw new Error(`face ${ref.faceName} is not planar`);
  const cut = subtractSketchRegionsFromFace(face, state.sketches.values());
  return {
    pf: { face: cut.face, edgeEntity: cut.edgeEntity, profileId: ref.faceName },
    n: plane.normal,
  };
}
export function applyProfileTools(
  state: EvalState,
  featureId: string,
  tools: ToolResult[],
  regions: ProfileFace[],
  operation: "newBody" | "join" | "cut" | "intersect",
  targets?: string[],
): FeatureOutcome | void {
  if (operation === "newBody") {
    registerNewBodies(state, featureId, tools, regions);
    return;
  }

  const tool = tools.slice(1).reduce((acc, next) => {
    const fused = fuseNamed(
      acc,
      next,
      featureId,
      "failed to merge profile solids",
    );

    return fused;
  }, tools[0]!);
  const unified = unifyTool(tool, featureId);

  return applyToolOperation(state, featureId, unified, operation, targets);
}
