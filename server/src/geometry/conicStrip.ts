import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import { planeSides } from "./blendSides.js";
import type { FilletSection } from "./blendModule.js";
import { V } from "./frames.js";
import { bboxOf, getKernel, type Own } from "./kernel.js";
import { planeFilletSection, type BlendStrip } from "./planarFillet.js";
import { boundsReach, stripFrame } from "./planarFilletSurface.js";

function conicFace(
  first: FilletSection,
  last: FilletSection,
  radii: [number, number],
  own: Own,
  bounds: ReturnType<typeof bboxOf>,
) {
  const k = getKernel();
  const along = V.sub(last.centre, first.centre);
  const axis = V.normalize(along);
  const sine = (radii[1] - radii[0]) / V.norm(along);
  const cosine = Math.sqrt(1 - sine * sine);
  const radial = (point: Vec3) => {
    const offset = V.sub(point, first.centre);
    return V.normalize(V.sub(offset, V.scale(axis, V.dot(offset, axis))));
  };
  const [a, b] = first.contacts.map(radial) as [Vec3, Vec3];
  const frame = stripFrame(first.centre, axis, [a, b], own);
  const reach = boundsReach(bounds, first.centre, axis).map((v) => v / cosine);
  const radius = radii[0] / cosine;
  const narrowest = (Math.min(...radii) / cosine / 1000 - radius) / sine;
  const span: [number, number] =
    sine > 0
      ? [Math.max(narrowest, Math.min(...reach)), Math.max(...reach)]
      : [Math.min(...reach), Math.min(narrowest, Math.max(...reach))];
  const make = own(
    new k.BRepBuilderAPI_MakeFace_11(
      own(new k.gp_Cone_2(frame, Math.asin(sine), radius)),
      0,
      Math.acos(V.dot(a, b)),
      ...span,
    ),
  );
  if (!make.IsDone())
    throw new Error("the variable fillet cone could not be built");
  const face = own(make.Face());
  if (!frame.Direct()) face.Reverse();
  return face;
}

export function conicStrip(
  radii: [number, number],
  starts: Vec3[],
): BlendStrip {
  return {
    kind: "fillet",
    size: Math.min(...radii),
    sides: planeSides,
    face(points, sides, _axis, own, bounds) {
      const forward = starts.some(
        (start) => V.norm(V.sub(start, points[0])) <= LINEAR_TOL,
      );
      const [r0, r1] = forward ? radii : [radii[1], radii[0]];
      return conicFace(
        planeFilletSection(points, sides, r0)[0],
        planeFilletSection(points, sides, r1)[1],
        [r0, r1],
        own,
        bounds,
      );
    },
  };
}
