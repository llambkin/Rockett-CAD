import { findProfile, LINEAR_TOL, type LoftFeature } from "@rockett/shared";
import { applyToolOperation, joinEvery } from "./boolean.js";
import { invalidPart, type EvalState } from "./featureState.js";
import {
  edges,
  getKernel,
  kernelCall,
  planarFacePlane,
  progress,
  scoped,
  solids,
  volumeOf,
  wires,
  type Shape,
} from "./kernel.js";
import {
  finalizeNames,
  findFace,
  namingVersion,
  sweptNames,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import {
  buildProfileFace,
  sideEdgeNames,
  type ProfileFace,
} from "./sketchGeom.js";

function sectionFace(
  state: EvalState,
  ref: LoftFeature["sections"][number],
  own: (shape: Shape) => Shape,
): ProfileFace {
  if ("kind" in ref) {
    const body = state.bodies.get(ref.bodyId);
    if (!body) throw new Error(`body ${ref.bodyId} no longer exists`);
    const face = findFace(body, ref.faceName);
    if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
    own(face);
    if (!planarFacePlane(face))
      throw new Error("loft section face must be planar");
    return { face, edgeEntity: new ShapeMap(), profileId: ref.faceName };
  }
  const sketch = state.sketches.get(ref.sketchId);
  if (!sketch) throw new Error(`sketch ${ref.sketchId} not found`);
  const profile = findProfile(sketch, ref.profileId);
  if (!profile) throw new Error(`profile ${ref.profileId} not found`);
  const pf = buildProfileFace(profile, sketch.entities, sketch.frame);
  own(pf.face);
  return pf;
}

export function evalLoft(state: EvalState, f: LoftFeature) {
  const k = getKernel();
  if (f.sections.length < 2)
    throw new Error("loft requires at least two sections");
  const sources = [
    ...new Set(
      f.sections.flatMap((ref) => ("kind" in ref ? [ref.bodyId] : [])),
    ),
  ];
  const tool = kernelCall("loft", () =>
    scoped((own) => {
      const thru = own(
        new k.BRepOffsetAPI_ThruSections(true, false, LINEAR_TOL),
      );
      let first: { pf: ProfileFace; wire: Shape } | undefined;
      for (const ref of f.sections) {
        const pf = sectionFace(state, ref, own);
        const outlines = wires(pf.face).map(own);
        if (!outlines[0]) throw new Error("loft section has no wire");
        if ("kind" in ref && outlines.length !== 1)
          throw new Error(
            "loft faces with holes are not supported; select a face with one outline",
          );
        thru.AddWire(outlines[0]);
        first ??= { pf, wire: outlines[0] };
      }
      thru.Build(progress());
      if (!thru.IsDone())
        throw new Error("loft failed: sections may be incompatible");
      const shape = thru.Shape();
      try {
        if (
          sources.length > 0 &&
          (invalidPart(shape) ||
            scoped((keep) => solids(shape).map(keep).length !== 1) ||
            volumeOf(shape) <= LINEAR_TOL ** 3)
        )
          throw new Error(
            "loft did not produce a valid solid; choose distinct, compatible sections in order",
          );
        const names =
          namingVersion() === 1
            ? finalizeNames(shape, new ShapeMap(), f.id)
            : sweptNames(
                shape,
                f.id,
                sideEdgeNames(f.id, first!.pf, edges(first!.wire)),
                (e) => thru.Generated(e),
                [thru.FirstShape(), thru.LastShape()],
              );
        return { shape, names };
      } catch (error) {
        shape.delete();
        throw error;
      }
    }),
  );
  try {
    return f.operation === "join" && sources.length > 0
      ? joinEvery(state, f.id, tool, [
          ...new Set([...sources, ...(f.targets ?? [])]),
        ])
      : applyToolOperation(state, f.id, tool, f.operation, f.targets);
  } finally {
    tool.shape.delete();
  }
}
