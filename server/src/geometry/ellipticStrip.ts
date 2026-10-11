import { LINEAR_TOL, UNIT_DOT_TOL, type Vec3 } from "@rockett/shared";
import { planeSides, type PlanarSide } from "./blendSides.js";
import { NoCorner } from "./featureState.js";
import { V } from "./frames.js";
import { dir, getKernel, pnt, vec, type Own, type Shape } from "./kernel.js";
import type { BlendStrip } from "./planarFillet.js";
import { boundsReach } from "./planarFilletSurface.js";

export type MeasuredEdge = { mid: Vec3; normal: Vec3 };

type Section = {
  centre: Vec3;
  major: Vec3;
  minor: Vec3;
  radii: [number, number];
  range: [number, number];
};

export function ellipticSection(
  edge: Vec3,
  into: [Vec3, Vec3],
  distances: [number, number],
): Section {
  const [e1, e2] = into;
  const c = V.dot(e1, e2);
  if (1 - Math.abs(c) <= UNIT_DOT_TOL)
    throw new NoCorner(
      "no sharp corner to fillet: the faces meet smoothly there",
    );
  const stretch = (v: Vec3) => {
    const [a, b] = [V.dot(v, e1), V.dot(v, e2)];
    return V.add(
      V.scale(e1, (distances[0] * (a - c * b)) / (1 - c * c)),
      V.scale(e2, (distances[1] * (b - c * a)) / (1 - c * c)),
    );
  };
  const middle = V.scale(V.add(e1, e2), 1 / (1 + c));
  const radius = Math.tan(Math.acos(c) / 2);
  const a = V.scale(V.sub(e1, middle), 1 / radius);
  const toSecond = V.sub(e2, middle);
  const b = V.normalize(V.sub(toSecond, V.scale(a, V.dot(toSecond, a))));
  const p = V.scale(stretch(a), radius);
  const q = V.scale(stretch(b), radius);
  const turn = Math.atan2(2 * V.dot(p, q), V.dot(p, p) - V.dot(q, q)) / 2;
  const u = V.add(V.scale(p, Math.cos(turn)), V.scale(q, Math.sin(turn)));
  const w = V.sub(V.scale(q, Math.cos(turn)), V.scale(p, Math.sin(turn)));
  const [major, minor, start] =
    V.norm(u) >= V.norm(w)
      ? [u, w, -turn]
      : [w, V.scale(u, -1), -turn - Math.PI / 2];
  return {
    centre: V.add(edge, stretch(middle)),
    major: V.normalize(major),
    minor: V.normalize(minor),
    radii: [V.norm(major), V.norm(minor)],
    range: [start, start + Math.PI - Math.acos(c)],
  };
}

function sameSection(a: Section, b: Section, axis: Vec3) {
  const offset = V.sub(b.centre, a.centre);
  return (
    V.norm(V.sub(offset, V.scale(axis, V.dot(offset, axis)))) <= LINEAR_TOL &&
    Math.abs(a.radii[0] - b.radii[0]) <= LINEAR_TOL &&
    Math.abs(a.radii[1] - b.radii[1]) <= LINEAR_TOL &&
    1 - V.dot(a.major, b.major) <= UNIT_DOT_TOL &&
    1 - V.dot(a.minor, b.minor) <= UNIT_DOT_TOL
  );
}

function measuredSide(
  points: [Vec3, Vec3],
  sides: [PlanarSide, PlanarSide],
  measured: MeasuredEdge[],
) {
  const mid = V.scale(V.add(points[0], points[1]), 0.5);
  const entry = measured.find((m) => V.norm(V.sub(m.mid, mid)) <= LINEAR_TOL);
  const index = sides.findIndex(
    (side) => entry && 1 - V.dot(side.normal, entry.normal) <= UNIT_DOT_TOL,
  );
  if (index < 0) throw new Error("the two-distance fillet lost its faces");
  return index;
}

function stripFace(
  section: Section,
  axis: Vec3,
  span: [number, number],
  own: Own,
) {
  const k = getKernel();
  const normal = V.cross(section.major, section.minor);
  const base = V.add(section.centre, V.scale(axis, span[0]));
  const frame = own(
    new k.gp_Ax2_2(
      own(pnt(...base)),
      own(dir(...normal)),
      own(dir(...section.major)),
    ),
  );
  const arc = own(
    new k.BRepBuilderAPI_MakeEdge_13(
      own(new k.gp_Elips_2(frame, ...section.radii)),
      ...section.range,
    ),
  );
  if (!arc.IsDone()) throw new Error("the two-distance fillet arc failed");
  const prism = own(
    new k.BRepPrimAPI_MakePrism_1(
      own(arc.Edge()),
      own(vec(...V.scale(axis, span[1] - span[0]))),
      false,
      false,
    ),
  );
  if (!prism.IsDone())
    throw new Error("the two-distance fillet surface failed");
  return own(k.TopoDS.Face_1(own(prism.Shape())));
}

export function ellipticStrip(
  distances: [number, number],
  measured: MeasuredEdge[],
): BlendStrip {
  const made: { section: Section; face: Shape }[] = [];
  return {
    kind: "fillet",
    size: Math.min(...distances),
    sides: planeSides,
    face(points, sides, axis, own, bounds) {
      const first = measuredSide(points, sides, measured);
      const section = ellipticSection(
        points[0],
        [sides[0].into, sides[1].into],
        first === 0 ? distances : [distances[1], distances[0]],
      );
      const twin = made.find((m) => sameSection(m.section, section, axis));
      if (twin) {
        const k = getKernel();
        return own(
          k.TopoDS.Face_1(
            own(
              own(new k.BRepBuilderAPI_Copy_2(twin.face, false, false)).Shape(),
            ),
          ),
        );
      }
      const along = boundsReach(bounds, section.centre, axis);
      const face = stripFace(
        section,
        axis,
        [Math.min(...along), Math.max(...along)],
        own,
      );
      made.push({ section, face });
      return face;
    },
  };
}
