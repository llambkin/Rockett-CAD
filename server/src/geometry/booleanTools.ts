import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type PlaneFrame,
  type Profile,
  type Vec3,
} from "@rockett/shared";
import {
  bboxOf,
  dir,
  getKernel,
  pnt,
  progress,
  release,
  vec,
  faces as facesOf,
  type Shape,
} from "./kernel.js";
import { V, frameFromPlane, uvTo3d } from "./frames.js";
import { ShapeMap } from "./shapeMap.js";
import { finalizeNames, type NamedBody } from "./naming.js";
import {
  buildMaps,
  buildProfileFace,
  matchEdgesToEntities,
  type SketchOnPlane,
} from "./sketchGeom.js";

export function clippedEndBoxes(
  body: NamedBody,
  ends: { at: Vec3; out: Vec3 }[],
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const k = getKernel();
  const { min, max } = bboxOf(body.shape);
  const reach = 2 * V.norm(V.sub(max, min)) + 1;
  return ends.map((end) => {
    const { xAxis, yAxis, normal } = frameFromPlane(end.at, end.out);
    const corner = V.sub(end.at, V.scale(V.add(xAxis, yAxis), reach));
    const axes = own(
      new k.gp_Ax2_2(
        own(pnt(...corner)),
        own(dir(...normal)),
        own(dir(...xAxis)),
      ),
    );
    const box = own(
      new k.BRepPrimAPI_MakeBox_5(axes, 2 * reach, 2 * reach, reach),
    );
    return own(box.Shape());
  });
}

export function offsetFaceTool(
  current: NamedBody,
  face: Shape,
  normal: Vec3,
  distance: number,
  faceName: string,
  featureId: string,
) {
  const k = getKernel();
  const outward = distance > 0;
  const dist = Math.abs(distance);
  const dirVec: Vec3 = outward ? normal : [-normal[0], -normal[1], -normal[2]];
  const v = vec(dirVec[0] * dist, dirVec[1] * dist, dirVec[2] * dist);
  const prism = new k.BRepPrimAPI_MakePrism_1(face, v, false, true);
  prism.Build(progress());
  if (!prism.IsDone()) {
    prism.delete();
    throw new Error("offset face prism failed");
  }
  const toolShape = prism.Shape();
  const moved = new ShapeMap<string>();
  if (current.names.version === 2) {
    const last = prism.LastShape_1();
    const caps = facesOf(last);
    for (const cap of caps) moved.set(cap, faceName);
    release([...caps, last]);
  }
  const toolNames = finalizeNames(toolShape, moved, featureId);
  prism.delete();
  v.delete();

  return { shape: toolShape, names: toolNames };
}

export function splitPlaneFace(
  frame: PlaneFrame,
  diag: number,
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const k = getKernel();
  const pln = own(
    new k.gp_Pln_3(
      own(pnt(frame.origin[0], frame.origin[1], frame.origin[2])),
      own(dir(frame.normal[0], frame.normal[1], frame.normal[2])),
    ),
  );
  const faceMk = own(
    new k.BRepBuilderAPI_MakeFace_9(pln, -diag, diag, -diag, diag),
  );

  return own(faceMk.Face());
}

export function interiorSketchRegions(
  face: Shape,
  sketches: Iterable<SketchOnPlane>,
) {
  const k = getKernel();
  const faceT = k.TopoDS.Face_1(face);
  const surf = new k.BRepAdaptor_Surface_2(faceT, false);
  if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Plane) {
    surf.delete();
    return null;
  }
  const pln = surf.Plane();
  const loc = pln.Location();
  const axd = pln.Axis().Direction();
  const fp: Vec3 = [loc.X(), loc.Y(), loc.Z()];
  const fn: Vec3 = [axd.X(), axd.Y(), axd.Z()];
  surf.delete();
  const samples = (polygon: number[]): [number, number][] => {
    const n = polygon.length / 2;
    const out: [number, number][] = [];
    const step = Math.max(1, Math.ceil(n / 48));
    for (let i = 0; i < n; i += step) {
      out.push([polygon[i * 2]!, polygon[i * 2 + 1]!]);
    }
    return out;
  };

  const strictlyInside = (frame: PlaneFrame, polygon: number[]): boolean => {
    const pts = samples(polygon);
    if (pts.length === 0) return false;
    for (const [u, v] of pts) {
      const w = uvTo3d(frame, u, v);
      const cls = new k.BRepClass_FaceClassifier_4(
        faceT,
        pnt(w[0], w[1], w[2]),
        LINEAR_TOL,
        false,
        0.1,
      );
      const st = cls.State();
      cls.delete();
      if (st !== k.TopAbs_State.TopAbs_IN) return false;
    }
    return true;
  };
  const regions: { sk: SketchOnPlane; profile: Profile }[] = [];
  for (const sk of sketches) {
    const n = sk.frame.normal;
    const o = sk.frame.origin;
    const ndot = Math.abs(n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2]);
    if (ndot < 1 - UNIT_DOT_TOL) continue;
    const doff = Math.abs(
      (o[0] - fp[0]) * fn[0] + (o[1] - fp[1]) * fn[1] + (o[2] - fp[2]) * fn[2],
    );
    if (doff > 1e-5) continue;
    for (const p of sk.profiles) {
      if (p.area <= 1e-9) continue;
      if (strictlyInside(sk.frame, p.polygon)) regions.push({ sk, profile: p });
    }
  }

  return { faceT, regions };
}

export function sketchRegionCompound(
  regions: { sk: SketchOnPlane; profile: Profile }[],
): Shape {
  const k = getKernel();
  const builder = new k.BRep_Builder();
  const comp = new k.TopoDS_Compound();
  builder.MakeCompound(comp);
  for (const { sk, profile } of regions) {
    const pf = buildProfileFace(profile, sk.entities, sk.frame);
    builder.Add(comp, pf.face);
    pf.edgeEntity.release();
  }

  return comp;
}

export function sketchRegionEdgeNames(
  cutFace: Shape,
  regions: { sk: SketchOnPlane; profile: Profile }[],
) {
  const edgeEntity = new ShapeMap<string>();
  const bySketch = new Map<SketchOnPlane, Set<string>>();
  for (const { sk, profile } of regions) {
    let ids = bySketch.get(sk);
    if (!ids) bySketch.set(sk, (ids = new Set()));
    for (const c of profile.outer) ids.add(c.entityId);
    for (const h of profile.holes) for (const c of h) ids.add(c.entityId);
  }
  for (const [sk, ids] of bySketch) {
    const matched = matchEdgesToEntities(
      cutFace,
      [...ids],
      buildMaps(sk.entities),
      sk.frame,
    );
    try {
      for (const [edge, id] of matched.entries()) edgeEntity.set(edge, id);
    } finally {
      matched.release();
    }
  }

  return edgeEntity;
}
