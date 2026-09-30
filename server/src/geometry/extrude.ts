import type { ExtrudeFeature, Vec3 } from "@rockett/shared";
import type { EvalState, ToolResult } from "./featureState.js";
import {
  acquire,
  edges as edgesOf,
  faces as facesOf,
  getKernel,
  kernelCall,
  listToArray,
  progress,
  transformOp,
  vec,
} from "./kernel.js";
import { finalizeNames } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import type { ProfileFace } from "./sketchGeom.js";
import {
  resolveProfiles,
  faceProfile,
  applyProfileTools,
} from "./profileTools.js";

function buildPrism(
  featureId: string,
  profileFace: ProfileFace,
  direction: Vec3,
  distance: number,
  baseOffset: number,
  copyBase = false,
): ToolResult {
  const k = getKernel();
  return kernelCall("extrude", () => {
    let face = profileFace.face;
    let offsetEdgeEntity = profileFace.edgeEntity;
    if (baseOffset !== 0) {
      const trsf = acquire(new k.gp_Trsf_1());
      trsf.SetTranslation_1(
        vec(
          direction[0] * baseOffset,
          direction[1] * baseOffset,
          direction[2] * baseOffset,
        ),
      );
      const tr = transformOp(face, trsf);
      const moved = acquire(tr.Shape());
      const newMap = new ShapeMap<string>();
      for (const e of edgesOf(face)) {
        const id = profileFace.edgeEntity.get(e);
        if (!id) continue;
        try {
          const me = acquire(tr.ModifiedShape(e));
          newMap.set(me, id);
        } catch {}
      }
      offsetEdgeEntity = newMap;
      face = acquire(k.TopoDS.Face_1(moved));
    }
    const v = vec(
      direction[0] * distance,
      direction[1] * distance,
      direction[2] * distance,
    );
    const prism = acquire(
      new k.BRepPrimAPI_MakePrism_1(face, v, copyBase, true),
    );
    prism.Build(progress());
    if (!prism.IsDone()) {
      throw new Error("prism generation failed: is the profile closed?");
    }
    const shape = acquire(prism.Shape());

    const provisional = new ShapeMap<string>();
    const faceEdges = edgesOf(face);
    for (const e of faceEdges) {
      const entityId = offsetEdgeEntity.get(e);
      if (!entityId) continue;
      const gen = listToArray(prism.Generated(e));
      for (const g of gen) {
        if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
          provisional.set(g, `f:${featureId}:s:${entityId}`);
        }
      }
    }
    const firstShape = acquire(prism.FirstShape_1());
    const startCaps = facesOf(firstShape);
    for (const cap of startCaps) {
      provisional.set(cap, `f:${featureId}:cap:start`);
    }
    const lastShape = acquire(prism.LastShape_1());
    const endCaps = facesOf(lastShape);
    for (const cap of endCaps) {
      provisional.set(cap, `f:${featureId}:cap:end`);
    }

    const names = finalizeNames(shape, provisional, featureId);
    return { shape, names };
  });
}
export function evalExtrude(state: EvalState, f: ExtrudeFeature) {
  const dist = Math.abs(f.distance);
  if (dist <= 0) throw new Error("extrude distance must be non-zero");
  const faceRefs = f.faces ?? [];
  if (f.profiles.length === 0 && faceRefs.length === 0) {
    throw new Error("select at least one profile or planar face");
  }
  const sources: { pf: ProfileFace; n: Vec3; copy: boolean }[] = [];

  if (f.profiles.length > 0) {
    const { faces: profileFaces, sketch } = resolveProfiles(state, f.profiles);
    for (const pf of profileFaces) {
      sources.push({ pf, n: sketch.frame.normal, copy: false });
    }
  }

  for (const ref of faceRefs)
    sources.push({ ...faceProfile(state, ref), copy: true });
  const flip = f.distance < 0 ? -1 : 1;
  const startOffset = f.startOffset ?? 0;
  const tools: ToolResult[] = [];
  for (const { pf, n: n0, copy } of sources) {
    const sgn = (f.direction === "reverse" ? -1 : 1) * flip;
    const n: Vec3 = [sgn * n0[0], sgn * n0[1], sgn * n0[2]];
    const base = startOffset * sgn;
    if (f.direction === "normal" || f.direction === "reverse") {
      tools.push(buildPrism(f.id, pf, n, dist, base, copy));
    } else if (f.direction === "symmetric") {
      tools.push(buildPrism(f.id, pf, n, dist, base - dist / 2, copy));
    } else {
      const d2 = Math.abs(f.distance2 ?? 0);
      tools.push(buildPrism(f.id, pf, n, dist + d2, base - d2, copy));
    }
  }

  return applyProfileTools(
    state,
    f.id,
    tools,
    sources.map((s) => s.pf),
    f.operation,
    f.targets,
  );
}
