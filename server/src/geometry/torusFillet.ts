import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import {
  circleSides,
  cylinderOf,
  radial,
  torusSides,
  type PlanarSide,
} from "./blendSides.js";
import { V } from "./frames.js";
import {
  dir,
  edges,
  faces,
  getKernel,
  listToArray,
  pnt,
  progress,
  shapeList,
  type Own,
  type Shape,
} from "./kernel.js";
import { blendFaceName, type NamedBody } from "./naming.js";
import {
  assembleBlend,
  copiedBody,
  planeFilletSection,
  type BlendStrip,
  type Cell,
} from "./planarFillet.js";
import { planeBoundarySample } from "./planeBoundary.js";

const TURN = 2 * Math.PI;

function torusFace(
  p: Vec3,
  sides: PlanarSide[],
  radius: number,
  own: Own,
  turn: [number, number] = [0, TURN],
) {
  const k = getKernel();
  const wall = sides.find((side) => side.radius !== 0)!;
  const other = sides.find((side) => side !== wall)!;
  const cylinder = cylinderOf(wall.face, own)!;
  const out = V.normalize(radial(cylinder, p));
  const tangent = V.cross(cylinder.axis, out);
  const [section] = planeFilletSection(
    [p, V.add(p, tangent)],
    [other, wall],
    radius,
  );
  const major = V.dot(radial(cylinder, section.centre), out);
  if (major <= LINEAR_TOL)
    throw new Error("the torus fillet would reach its axis");
  const angle = (q: Vec3) => {
    const d = V.sub(q, section.centre);
    return Math.atan2(V.dot(d, cylinder.axis), V.dot(d, out));
  };
  const [a, b] = section.contacts.map(angle) as [number, number];
  const span = (((b - a) % TURN) + TURN) % TURN;
  const [start, sweep] = span > Math.PI ? [b, TURN - span] : [a, span];
  const frame = own(
    new k.gp_Ax3_3(
      own(pnt(...V.sub(section.centre, V.scale(out, major)))),
      own(dir(...cylinder.axis)),
      own(
        dir(
          ...V.add(
            V.scale(out, Math.cos(turn[0])),
            V.scale(tangent, Math.sin(turn[0])),
          ),
        ),
      ),
    ),
  );
  const make = own(
    new k.BRepBuilderAPI_MakeFace_13(
      own(new k.gp_Torus_2(frame, major, radius)),
      0,
      turn[1] - turn[0],
      start,
      start + sweep,
    ),
  );
  if (!make.IsDone()) throw new Error("the torus fillet could not be built");
  return own(make.Face());
}

export function arcTorusStrip(radius: number): BlendStrip {
  return {
    kind: "fillet",
    size: radius,
    sides: circleSides,
    face(points, sides, _axis, own) {
      const wall = sides.find((side) => side.radius !== 0)!;
      const cylinder = cylinderOf(wall.face, own)!;
      const middle = V.scale(wall.normal, Math.sign(wall.radius));
      const start = radial(cylinder, points[0]);
      const half = Math.acos(
        Math.max(-1, Math.min(1, V.dot(V.normalize(start), middle))),
      );
      const reach = (half + Math.PI) / 2;
      const p = V.add(
        V.sub(points[0], start),
        V.scale(middle, cylinder.radius),
      );
      return torusFace(p, sides, radius, own, [-reach, reach]);
    },
  };
}

type Guide = { guide: Shape; contacts: Shape[] };

function droppedBand(
  piece: Shape,
  guides: Guide[],
  images: (edge: Shape) => Shape[],
  own: Own,
) {
  const k = getKernel(),
    face = own(k.TopoDS.Face_1(piece)),
    bounds = edges(face).map(own);
  const held = guides.filter(({ guide }) =>
    bounds.some((edge) => edge.IsSame(guide)),
  );
  if (!held.length) return false;
  const allowed = held.length === 1 && [
    held[0]!.guide,
    ...held[0]!.contacts.flatMap(images),
  ];
  if (
    !allowed ||
    !bounds.every(
      (edge) =>
        k.BRep_Tool.IsClosed_2(edge, face) ||
        allowed.some((a) => a.IsSame(edge)),
    )
  )
    throw new Error("the torus fillet contacts overlap another boundary");
  return true;
}

function trimmedNeighbours(neighbours: Shape[], guides: Guide[], own: Own) {
  const k = getKernel();
  const splitter = own(new k.BRepAlgoAPI_Splitter_1());
  splitter.SetArguments(shapeList(neighbours));
  splitter.SetTools(shapeList(guides.flatMap(({ contacts }) => contacts)));
  splitter.Build(progress());
  if (!splitter.IsDone())
    throw new Error("the torus fillet contacts could not trim their faces");
  const images = (edge: Shape) => {
    const split = listToArray(splitter.Modified(edge));
    return split.length ? split : [edge];
  };
  return neighbours.map((face) => {
    const kept = listToArray(splitter.Modified(face)).filter(
      (piece) => !droppedBand(piece, guides, images, own),
    );
    if (kept.length !== 1)
      throw new Error("the torus fillet contact leaves its face");
    return own(k.TopoDS.Face_1(kept[0]));
  });
}

export type ClosedGuide = (
  guide: Shape,
  source: Shape[],
  own: Own,
) => { sides: PlanarSide[]; face: Shape };

export function torusGuide(radius: number): ClosedGuide {
  return (guide, source, own) => {
    const sides = torusSides(guide, source, own);
    if (!sides) throw new Error("the torus fillet guide changed in the copy");
    const { point } = planeBoundarySample(guide, sides[0]!.normal, own);
    const p: Vec3 = [point.X(), point.Y(), point.Z()];
    return { sides, face: torusFace(p, sides, radius, own) };
  };
}

export function closedBlend(
  body: NamedBody,
  chain: { edge: Shape }[],
  strip: Pick<BlendStrip, "kind" | "size">,
  featureId: string,
  closed: ClosedGuide,
  own: Own,
) {
  const k = getKernel();
  const original = faces(body.shape).map(own);
  const { source, edge: copiedEdge } = copiedBody(body, original, own);
  const guides = chain.map(({ edge }) => {
    const guide = copiedEdge(edge);
    return { guide, ...closed(guide, source, own) };
  });
  const neighbours = guides
    .flatMap(({ sides }) => sides.map((side) => side.face))
    .filter((face, i, all) => all.findIndex((f) => f.IsSame(face)) === i);
  const kept = trimmedNeighbours(
    neighbours,
    guides.map(({ guide, face }) => ({
      guide,
      contacts: edges(face)
        .map(own)
        .filter((edge) => !k.BRep_Tool.IsClosed_2(edge, face)),
    })),
    own,
  );
  const cells: Cell[] = source
    .map((face, i) => {
      const trimmed = neighbours.findIndex((n) => n.IsSame(face));
      return {
        face: trimmed < 0 ? face : kept[trimmed]!,
        name: body.names.get(original[i]!),
        made: false,
      };
    })
    .concat(
      guides.map(({ face }, i) => ({
        face,
        name: blendFaceName(featureId, i),
        made: true,
      })),
    );
  return assembleBlend(cells, body, strip, featureId, own);
}
