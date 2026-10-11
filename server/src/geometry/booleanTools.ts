import {
  faceRegions,
  LINEAR_TOL,
  type PlaneFrame,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  scoped,
  bboxOf,
  dir,
  getKernel,
  pnt,
  progress,
  vec,
  faces as facesOf,
  planarFacePlane,
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
  const prism = acquire(new k.BRepPrimAPI_MakePrism_1(face, v, false, true));
  prism.Build(progress());
  if (!prism.IsDone()) {
    throw new Error("offset face prism failed");
  }
  const toolShape = acquire(prism.Shape());
  const moved = new ShapeMap<string>();
  if (current.names.version === 2) {
    const last = acquire(prism.LastShape_1());
    const caps = facesOf(last);
    for (const cap of caps) moved.set(cap, faceName);
  }
  const toolNames = finalizeNames(toolShape, moved, featureId);

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

type Region = ReturnType<typeof faceRegions<SketchOnPlane>>[number];

export function interiorSketchRegions(
  face: Shape,
  sketches: Iterable<SketchOnPlane>,
) {
  const plane = planarFacePlane(face);
  if (!plane) return [];
  const frame = frameFromPlane(plane.origin, plane.normal);
  return scoped(() => {
    const k = getKernel();
    const faceT = acquire(k.TopoDS.Face_1(face));
    return faceRegions(frame, sketches, (u, v) => {
      const w = uvTo3d(frame, u, v);
      const cls = acquire(
        new k.BRepClass_FaceClassifier_4(
          faceT,
          pnt(w[0], w[1], w[2]),
          LINEAR_TOL,
          false,
          0.1,
        ),
      );
      return cls.State() === k.TopAbs_State.TopAbs_IN;
    });
  });
}

export function sketchRegionCompound(regions: Region[]): Shape {
  const k = getKernel();
  const builder = acquire(new k.BRep_Builder());
  const comp = acquire(new k.TopoDS_Compound());
  builder.MakeCompound(comp);
  for (const { sketch, profile } of regions) {
    const pf = buildProfileFace(
      { ...profile, holes: [] },
      sketch.entities,
      sketch.frame,
    );
    builder.Add(comp, pf.face);
    pf.edgeEntity.release();
  }

  return comp;
}

export function sketchRegionEdgeNames(cutFace: Shape, regions: Region[]) {
  const edgeEntity = new ShapeMap<string>();
  const bySketch = new Map<SketchOnPlane, Set<string>>();
  for (const { sketch, profile } of regions) {
    let ids = bySketch.get(sketch);
    if (!ids) bySketch.set(sketch, (ids = new Set()));
    for (const c of profile.outer) ids.add(c.entityId);
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
