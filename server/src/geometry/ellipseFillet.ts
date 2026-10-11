import { LINEAR_TOL, UNIT_DOT_TOL, type Vec3 } from "@rockett/shared";
import { cylinderOf, ellipseSides } from "./blendSides.js";
import { V } from "./frames.js";
import {
  dir,
  faces,
  getKernel,
  pnt,
  progress,
  shapeList,
  type Own,
  type Shape,
} from "./kernel.js";
import { planeFilletSection } from "./planarFillet.js";
import type { ClosedGuide } from "./torusFillet.js";

const TUBE_SCALE = 1000;

type Ellipse = { centre: Vec3; normal: Vec3; major: Vec3; radii: number[] };

function ellipseEdge({ centre, normal, major, radii }: Ellipse, own: Own) {
  const k = getKernel();
  const frame = own(
    new k.gp_Ax2_2(
      own(pnt(...centre)),
      own(dir(...normal)),
      own(dir(...major)),
    ),
  );
  const make = own(
    new k.BRepBuilderAPI_MakeEdge_12(
      own(new k.gp_Elips_2(frame, radii[0], radii[1])),
    ),
  );
  if (!make.IsDone()) throw new Error("the ellipse fillet curve failed");
  return own(make.Edge());
}

function wire(edge: Shape, own: Own) {
  const k = getKernel();
  return own(own(new k.BRepBuilderAPI_MakeWire_2(edge)).Wire());
}

function rollingBall(guide: Shape, source: Shape[], radius: number, own: Own) {
  const sides = ellipseSides(guide, source, own);
  if (!sides) throw new Error("the ellipse fillet guide changed in the copy");
  const plane = sides.find((side) => side.radius === 0)!;
  const wall = sides.find((side) => side !== plane)!;
  const cylinder = cylinderOf(wall.face, own)!;
  const k = getKernel(),
    curve = own(new k.BRepAdaptor_Curve_2(guide)),
    at = own(
      curve.EvalD0((curve.FirstParameter() + curve.LastParameter()) / 2),
    );
  const p: Vec3 = [at.X(), at.Y(), at.Z()];
  const tangent = V.normalize(V.cross(plane.normal, wall.normal));
  const [section] = planeFilletSection(
    [p, V.add(p, tangent)],
    [plane, wall],
    radius,
  );
  const shift = V.sub(section.centre, p);
  const lift = V.dot(shift, plane.normal);
  const spine = cylinder.radius + V.dot(shift, wall.normal) * cylinder.outward;
  const tilt = Math.abs(V.dot(cylinder.axis, plane.normal));
  if (tilt <= UNIT_DOT_TOL || spine * tilt <= radius + LINEAR_TOL)
    throw new Error("the ellipse fillet would fold over its spine");
  return { sides, plane, cylinder, p, lift, spine, tilt };
}

function geometry(guide: Shape, source: Shape[], radius: number, own: Own) {
  const { sides, plane, cylinder, p, lift, spine, tilt } = rollingBall(
    guide,
    source,
    radius,
    own,
  );
  const n = plane.normal,
    a = cylinder.axis;
  const centre = V.add(
    cylinder.origin,
    V.scale(a, (V.dot(n, p) + lift - V.dot(n, cylinder.origin)) / V.dot(n, a)),
  );
  const major = V.normalize(V.sub(a, V.scale(n, V.dot(a, n))));
  const rise = (spine / tilt) * V.dot(major, a);
  const out = V.normalize(V.sub(major, V.scale(a, V.dot(major, a))));
  const contact = V.add(V.scale(out, cylinder.radius), V.scale(a, rise));
  const start = V.add(centre, V.scale(major, spine / tilt));
  const towards = V.normalize(
    V.add(
      V.scale(n, -Math.sign(lift)),
      V.scale(out, Math.sign(cylinder.radius - spine)),
    ),
  );
  return {
    sides,
    spine: { centre, normal: n, major, radii: [spine / tilt, spine] },
    plane: {
      centre: V.sub(centre, V.scale(n, lift)),
      normal: n,
      major,
      radii: [spine / tilt, spine],
    },
    wall: {
      centre,
      normal: V.normalize(V.cross(contact, V.cross(n, major))),
      major: V.normalize(contact),
      radii: [V.norm(contact), cylinder.radius],
    },
    start,
    tangent: V.cross(n, major),
    towards,
    middle: V.add(start, V.scale(towards, radius)),
  };
}

function tube(shape: ReturnType<typeof geometry>, radius: number, own: Own) {
  const k = getKernel();
  const centre = shape.spine.centre;
  const frame = own(
    new k.gp_Ax2_2(
      own(
        pnt(...V.add(centre, V.scale(V.sub(shape.start, centre), TUBE_SCALE))),
      ),
      own(dir(...shape.tangent)),
      own(dir(...V.scale(shape.towards, -1))),
    ),
  );
  const profile = own(
    new k.BRepBuilderAPI_MakeEdge_8(
      own(new k.gp_Circ_2(frame, radius * TUBE_SCALE)),
    ),
  );
  const pipe = own(
    new k.BRepOffsetAPI_MakePipe_1(
      wire(
        ellipseEdge(
          {
            ...shape.spine,
            radii: shape.spine.radii.map((x) => x * TUBE_SCALE),
          },
          own,
        ),
        own,
      ),
      wire(own(profile.Edge()), own),
    ),
  );
  if (!pipe.IsDone()) throw new Error("the ellipse fillet tube failed");
  const trsf = own(new k.gp_Trsf_1());
  trsf.SetScale(own(pnt(...centre)), 1 / TUBE_SCALE);
  const moved = own(
    new k.BRepBuilderAPI_Transform_2(own(pipe.Shape()), trsf, true, false),
  );
  const [made] = faces(own(moved.Shape())).map(own);
  return made;
}

function band(pieces: Shape[], middle: Vec3, own: Own) {
  const k = getKernel(),
    point = own(
      own(new k.BRepBuilderAPI_MakeVertex(own(pnt(...middle)))).Vertex(),
    );
  const gaps = pieces.map((piece) => {
    const distance = own(
      new k.BRepExtrema_DistShapeShape_2(
        piece,
        point,
        k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
        k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
        progress(),
      ),
    );
    return distance.IsDone() ? distance.Value() : Infinity;
  });
  const nearest = gaps.indexOf(Math.min(...gaps));
  if (!(gaps[nearest]! <= LINEAR_TOL))
    throw new Error("the ellipse fillet band could not be cut from its tube");
  return own(k.TopoDS.Face_1(pieces[nearest]));
}

export function ellipseGuide(radius: number): ClosedGuide {
  return (guide, source, own) => {
    const k = getKernel();
    const shape = geometry(guide, source, radius, own);
    const splitter = own(new k.BRepAlgoAPI_Splitter_1());
    splitter.SetArguments(shapeList([tube(shape, radius, own)]));
    splitter.SetTools(
      shapeList([ellipseEdge(shape.plane, own), ellipseEdge(shape.wall, own)]),
    );
    splitter.Build(progress());
    if (!splitter.IsDone())
      throw new Error("the ellipse fillet contacts could not cut its tube");
    const pieces = faces(own(splitter.Shape())).map(own);
    return { sides: shape.sides, face: band(pieces, shape.middle, own) };
  };
}
