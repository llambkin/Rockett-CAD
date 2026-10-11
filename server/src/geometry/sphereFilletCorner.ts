import { storedSurfaceCurve } from "./storedSurfaceCurve.js";
import assert from "node:assert/strict";
import type { Vec3 } from "@rockett/shared";
import {
  getKernel,
  edges,
  vertices,
  pnt,
  dir,
  progress,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import { planarFaceBoundary } from "./faceBoundary.js";

type CornerPatch = {
  index: number;
  planes: [number, number];
  face: Shape;
  cap: Shape;
};

function sphereSupport(
  centre: Vec3,
  normals: [Vec3, Vec3, Vec3],
  radius: number,
  own: Own,
) {
  const k = getKernel();
  const axis = V.scale(normals[0], -1);
  const x = V.normalize(V.cross(axis, V.cross(normals[1], axis)));
  const frame = own(
    new k.gp_Ax3_3(own(pnt(...centre)), own(dir(...axis)), own(dir(...x))),
  );
  const initialY = own(frame.YDirection());
  if (V.dot([initialY.X(), initialY.Y(), initialY.Z()], normals[2]) <= 0)
    frame.YReverse();
  const xx = own(frame.XDirection()),
    y = own(frame.YDirection());
  const u3 = Math.atan2(
    V.dot(normals[2], [y.X(), y.Y(), y.Z()]),
    V.dot(normals[2], [xx.X(), xx.Y(), xx.Z()]),
  );
  assert(u3 > 0 && u3 < Math.PI);
  const sphere = own(new k.gp_Sphere_2(frame, radius));
  const support = own(
    own(
      new k.BRepBuilderAPI_MakeFace_12(
        sphere,
        0,
        u3,
        -Math.PI / 2,
        Math.PI / 2,
      ),
    ).Face(),
  );
  const plane = own(
    own(
      new k.BRepBuilderAPI_MakeFace_3(
        own(
          new k.gp_Pln_3(
            own(pnt(...centre)),
            own(dir(...V.normalize(V.cross(normals[1], normals[2])))),
          ),
        ),
      ),
    ).Face(),
  );
  const section = own(new k.BRepAlgoAPI_Section_3(support, plane, false));
  section.Approximation(true);
  section.ComputePCurveOn1(true);
  section.ComputePCurveOn2(true);
  section.SetNonDestructive(true);
  section.Build(progress());
  assert(section.IsDone());
  const curves = edges(own(section.Shape())).map(own);
  assert.equal(curves.length, 1);
  const shared = curves[0]!;
  assert.equal(
    own(new k.BRepAdaptor_Curve_2(shared)).GetType(),
    k.GeomAbs_CurveType.GeomAbs_Circle,
  );
  return {
    support,
    shared,
    frame,
    axis,
    u3,
    surface: own(k.BRep_Tool.Surface_2(support)),
  };
}

function shortenedMeridian(
  old: Shape,
  pole: Shape,
  contact: Shape,
  sphereV: number,
  surface: any,
  own: Own,
) {
  const k = getKernel();
  const representation = storedSurfaceCurve(
    old,
    surface,
    own(new (getKernel().TopLoc_Location_1)()),
    own,
  );
  const oldCurve = own(new k.BRepAdaptor_Curve_2(old));
  assert(
    own(oldCurve.Value(sphereV)).Distance(own(k.BRep_Tool.Pnt(contact))) <=
      k.BRep_Tool.Tolerance_2(old),
  );
  const make = own(
    new k.BRepBuilderAPI_MakeEdge_29(
      own(k.BRep_Tool.Curve_2(old, 0, 0)),
      pole,
      contact,
      -Math.PI / 2,
      sphereV,
    ),
  );
  assert(make.IsDone());
  const edge = own(make.Edge());
  const curve = own(new k.BRepAdaptor_Curve_2(edge));
  representation.pc
    .get()
    .Translate_1(
      own(
        new k.gp_Vec2d_4(0, oldCurve.FirstParameter() - curve.FirstParameter()),
      ),
    );
  own(new k.BRep_Builder()).UpdateEdge_5(
    edge,
    representation.pc,
    surface,
    representation.location,
    k.BRep_Tool.Tolerance_2(edge),
  );
  if (!own(k.TopExp.FirstVertex(old, true)).IsSame(pole)) edge.Reverse();
  return edge;
}

function meridianContact(
  old: Shape,
  support: ReturnType<typeof sphereSupport>,
  centre: Vec3,
  normals: [Vec3, Vec3, Vec3],
  radius: number,
  own: Own,
) {
  const k = getKernel();
  const curve = own(new k.BRepAdaptor_Curve_2(old));
  const uv = own(
    storedSurfaceCurve(
      old,
      support.surface,
      own(new (getKernel().TopLoc_Location_1)()),
      own,
    )
      .pc.get()
      .Value((curve.FirstParameter() + curve.LastParameter()) / 2),
  );
  const index = Math.abs(uv.X()) < Math.abs(uv.X() - support.u3) ? 1 : 2;
  const target = V.add(centre, V.scale(normals[index]!, radius));
  const matches = vertices(support.shared)
    .map(own)
    .filter(
      (vertex) =>
        V.norm(V.sub(vertexPoint(vertex), target)) <=
        k.BRep_Tool.Tolerance_3(vertex),
    );
  assert.equal(matches.length, 1);
  const contact = matches[0]!;
  const sphereV = Math.asin(
    V.dot(V.normalize(V.sub(vertexPoint(contact), centre)), support.axis),
  );
  return { index, contact, sphereV };
}

function sphereBoundary(
  support: ReturnType<typeof sphereSupport>,
  centre: Vec3,
  normals: [Vec3, Vec3, Vec3],
  radius: number,
  own: Own,
) {
  const k = getKernel();
  const original = edges(support.support).map(own);
  const collapsed = original.filter((edge) => k.BRep_Tool.Degenerated(edge));
  assert.equal(collapsed.length, 2);
  const pole = collapsed.find((edge) =>
    vertices(edge)
      .map(own)
      .every(
        (vertex) =>
          Math.abs(
            V.dot(V.sub(vertexPoint(vertex), centre), support.axis) + radius,
          ) <= k.BRep_Tool.Tolerance_3(vertex),
      ),
  );
  assert(pole);
  const poleVertex = vertices(pole).map(own)[0]!;
  const edits = original
    .filter((edge) => !k.BRep_Tool.Degenerated(edge))
    .map((old) => {
      const { index, contact, sphereV } = meridianContact(
        old,
        support,
        centre,
        normals,
        radius,
        own,
      );
      return {
        edge: old,
        replacement: [
          shortenedMeridian(
            old,
            poleVertex,
            contact,
            sphereV,
            support.surface,
            own,
          ),
        ],
        planes: [0, index] as [number, number],
      };
    });
  assert.equal(edits.length, 2);
  const first = edits.find((edit) =>
    own(k.TopExp.FirstVertex(edit.replacement[0]!, true)).IsSame(poleVertex),
  );
  const second = edits.find(
    (edit) =>
      !own(k.TopExp.FirstVertex(edit.replacement[0]!, true)).IsSame(poleVertex),
  );
  assert(first && second);
  const arc = own(k.TopoDS.Edge_1(support.shared));
  const start = own(k.TopExp.LastVertex(first.replacement[0]!, true));
  if (!own(k.TopExp.FirstVertex(arc, true)).IsSame(start)) arc.Reverse();
  assert(
    own(k.TopExp.LastVertex(arc, true)).IsSame(
      own(k.TopExp.FirstVertex(second.replacement[0]!, true)),
    ),
  );
  const top = collapsed.find((edge) => !edge.IsSame(pole));
  assert(top);
  return {
    edits: [
      ...edits,
      { edge: top, replacement: [arc], planes: [1, 2] as [number, number] },
    ],
  };
}

function attachCylinderCurve(
  edge: Shape,
  face: Shape,
  cap: Shape,
  centre: Vec3,
  own: Own,
) {
  const k = getKernel();
  const location = own(new k.TopLoc_Location_1());
  const surface = own(k.BRep_Tool.Surface_1(face, location));
  const cylinder = own(
    own(new k.BRepAdaptor_Surface_2(face, false)).Cylinder(),
  );
  const frame = own(cylinder.Position());
  const x = own(frame.XDirection()),
    y = own(frame.YDirection()),
    z = own(frame.Direction()),
    origin = own(frame.Location());
  const axis: Vec3 = [z.X(), z.Y(), z.Z()];
  const offset = V.sub(centre, [origin.X(), origin.Y(), origin.Z()]);
  const v = V.dot(offset, axis);
  assert(
    edges(face)
      .map(own)
      .some((candidate) => candidate.IsSame(cap)),
  );
  assert.equal(
    own(new k.BRepAdaptor_Curve_2(cap)).GetType(),
    k.GeomAbs_CurveType.GeomAbs_Circle,
  );
  const pc = storedSurfaceCurve(
    cap,
    surface,
    own(new (getKernel().TopLoc_Location_1)()),
    own,
  ).pc;
  const curve = own(new k.BRepAdaptor_Curve_2(edge));
  const circle = own(curve.Circle()),
    position = own(circle.Position()),
    normal = own(position.Direction());
  const direction =
    Math.sign(V.dot([normal.X(), normal.Y(), normal.Z()], axis)) *
    (frame.Direct() ? 1 : -1);
  assert(Math.abs(direction) === 1);
  const parameter = curve.FirstParameter(),
    point = own(curve.Value(parameter));
  const radial = V.sub([point.X(), point.Y(), point.Z()], centre);
  const u = Math.atan2(
    V.dot(radial, [y.X(), y.Y(), y.Z()]),
    V.dot(radial, [x.X(), x.Y(), x.Z()]),
  );
  const isolatedPC = own(pc.get().Reversed());
  isolatedPC.get().Reverse();
  const old = own(pc.get().Value(0));
  const transform = own(new k.gp_Trsf2d_1());
  transform.SetValues(
    direction,
    0,
    u - direction * parameter - direction * old.X(),
    0,
    1,
    v - old.Y(),
  );
  isolatedPC.get().Transform(transform);
  own(new k.BRep_Builder()).UpdateEdge_5(
    edge,
    isolatedPC,
    surface,
    location,
    k.BRep_Tool.Tolerance_2(edge),
  );
  verifyCylinderCurve(edge, curve, isolatedPC, surface, location, own);
}

export function moduleSphereCorner(
  origin: Vec3,
  normals: [Vec3, Vec3, Vec3],
  radius: number,
  patches: CornerPatch[],
  own: Own,
) {
  const determinant = V.dot(normals[0], V.cross(normals[1], normals[2]));
  assert(determinant !== 0 && Number.isFinite(determinant));
  const offset = V.scale(
    V.add(
      V.add(V.cross(normals[1], normals[2]), V.cross(normals[2], normals[0])),
      V.cross(normals[0], normals[1]),
    ),
    -radius / determinant,
  );
  const centre = V.add(origin, offset);
  assert(centre.every(Number.isFinite));
  const support = sphereSupport(centre, normals, radius, own);
  const boundary = sphereBoundary(support, centre, normals, radius, own);
  const ends = boundary.edits.map((edit) => {
    const matching = patches.filter((patch) =>
      edit.planes.every((plane) => patch.planes.includes(plane)),
    );
    assert.equal(matching.length, 1);
    const patch = matching[0]!,
      edge = edit.replacement[0]!;
    attachCylinderCurve(edge, patch.face, patch.cap, centre, own);
    return { index: patch.index, edge };
  });
  const face = planarFaceBoundary(support.support, boundary.edits, own);
  if (!support.frame.Direct()) face.Reverse();
  return { face, ends, centre };
}

function verifyCylinderCurve(
  edge: Shape,
  curve: any,
  pc: any,
  surface: any,
  location: Shape,
  own: Own,
) {
  const k = getKernel();
  for (const t of [
    curve.FirstParameter(),
    (curve.FirstParameter() + curve.LastParameter()) / 2,
    curve.LastParameter(),
  ]) {
    const uv = own(pc.get().Value(t)),
      world = own(surface.get().Value(uv.X(), uv.Y()));
    world.Transform(own(location.Transformation()));
    assert(
      world.Distance(own(curve.Value(t))) <= k.BRep_Tool.Tolerance_2(edge),
    );
  }
}
