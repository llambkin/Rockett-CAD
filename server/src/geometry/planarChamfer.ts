import { LINEAR_TOL, UNIT_DOT_TOL, type Vec3 } from "@rockett/shared";
import { V } from "./frames.js";
import {
  edges,
  faces,
  getKernel,
  handles,
  isValidShape,
  planarFacePlane,
  pnt,
  progress,
  scoped,
  solids,
  vec,
  vertices,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { propagateNames, type NamedBody } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";

type Corner = {
  start: Vec3;
  delta: Vec3;
  normals: Vec3[];
  points: Vec3[][];
  rectangular: boolean;
};

function corner(body: NamedBody, edge: Shape): Corner | null {
  return scoped((own) => {
    const k = getKernel();
    const curve = own(new k.BRepAdaptor_Curve_2(edge));
    if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) return null;
    const a = own(curve.Value(curve.FirstParameter()));
    const b = own(curve.Value(curve.LastParameter()));
    const start: Vec3 = [a.X(), a.Y(), a.Z()];
    const delta = V.sub([b.X(), b.Y(), b.Z()], start);
    const adjacent = faces(body.shape)
      .map(own)
      .filter((face) =>
        edges(face)
          .map(own)
          .some((candidate) => candidate.IsSame(edge)),
      );
    if (adjacent.length !== 2) return null;
    const planes = adjacent.map(planarFacePlane);
    if (planes.some((plane) => !plane)) return null;
    const normals = planes.map((plane) => plane!.normal);
    const points = adjacent.map((face) =>
      vertices(face)
        .map(own)
        .map((vertex) => {
          const point = own(k.BRep_Tool.Pnt(vertex));
          return [point.X(), point.Y(), point.Z()] as Vec3;
        }),
    );
    const rectangular = adjacent.every((face) => {
      const boundary = edges(face).map(own);
      return (
        boundary.length >= 4 &&
        boundary.every(
          (e) =>
            own(new k.BRepAdaptor_Curve_2(e)).GetType() ===
            k.GeomAbs_CurveType.GeomAbs_Line,
        )
      );
    });
    return { start, delta, normals, points, rectangular };
  });
}

function turn(c: Corner): number {
  const alignment = V.dot(c.normals[0]!, c.normals[1]!);
  if (alignment > 1 - UNIT_DOT_TOL) return 2;
  if (Math.abs(alignment) > UNIT_DOT_TOL) return 0;
  const signs = c.points.map((points, i) => {
    const distances = points.map((p) =>
      V.dot(V.sub(p, c.start), c.normals[1 - i]!),
    );
    if (
      distances.every((d) => d >= -LINEAR_TOL) &&
      distances.some((d) => d > LINEAR_TOL)
    )
      return 1;
    if (
      distances.every((d) => d <= LINEAR_TOL) &&
      distances.some((d) => d < -LINEAR_TOL)
    )
      return -1;
    return 0;
  });
  return signs[0] === signs[1] ? signs[0]! : 0;
}

export function chamferContinuity(
  body: NamedBody,
  byName: Map<string, Shape>,
): (a: string, b: string) => boolean {
  const turns = new Map<string, number>();
  const get = (name: string) => {
    if (!turns.has(name)) {
      const c = corner(body, byName.get(name)!);
      turns.set(name, c ? turn(c) : 0);
    }
    return turns.get(name)!;
  };
  return (a, b) => !get(a) || !get(b) || get(a) === get(b);
}

function fits(c: Corner, distance: number): boolean {
  if (!c.rectangular || turn(c) !== 1) return false;
  const length = V.norm(c.delta);
  if (length <= LINEAR_TOL) return false;
  const axis = V.scale(c.delta, 1 / length);
  return c.points.every((points, i) => {
    if (points.length < 4) return false;
    const uv = points.map((p) => {
      const offset = V.sub(p, c.start);
      return [V.dot(offset, axis), V.dot(offset, c.normals[1 - i]!)] as const;
    });
    const width = Math.max(...uv.map((p) => p[1]));
    return (
      distance <= width + LINEAR_TOL &&
      uv.every(
        ([u, v]) =>
          u >= -LINEAR_TOL &&
          u <= length + LINEAR_TOL &&
          v >= -LINEAR_TOL &&
          v <= width + LINEAR_TOL &&
          (Math.abs(u) < LINEAR_TOL ||
            Math.abs(u - length) < LINEAR_TOL ||
            Math.abs(v) < LINEAR_TOL ||
            Math.abs(v - width) < LINEAR_TOL),
      ) &&
      [0, length].every((u) =>
        [0, width].every((v) =>
          uv.some(
            ([x, y]) =>
              Math.abs(x - u) < LINEAR_TOL && Math.abs(y - v) < LINEAR_TOL,
          ),
        ),
      )
    );
  });
}

function wedge(c: Corner, distance: number): Shape {
  return scoped((own) => {
    const k = getKernel();
    const points = [
      c.start,
      ...c.normals.map((n) => V.add(c.start, V.scale(n, distance))),
    ].map((p) => own(pnt(...p)));
    const polygon = own(new k.BRepBuilderAPI_MakePolygon_3(...points, true));
    const wire = own(polygon.Wire());
    const maker = own(new k.BRepBuilderAPI_MakeFace_15(wire, true));
    const face = own(maker.Face());
    const prism = own(
      new k.BRepPrimAPI_MakePrism_1(face, own(vec(...c.delta)), false, true),
    );
    return prism.Shape();
  });
}

function bevelNames(shape: Shape, c: Corner, name: string): ShapeMap<string> {
  return scoped((own) => {
    const names = new ShapeMap<string>();
    for (const face of faces(shape).map(own)) {
      const plane = planarFacePlane(face);
      if (
        plane &&
        c.normals.every((n) => Math.abs(V.dot(n, plane.normal)) > UNIT_DOT_TOL)
      )
        names.set(face, name);
    }
    return names;
  });
}

export function chamferInnerCorners(
  body: NamedBody,
  selected: { edge: Shape }[],
  distance: number,
  featureId: string,
): NamedBody | null {
  const corners = selected.map(({ edge }) => corner(body, edge));
  if (!corners.length || corners.some((c) => !c || !fits(c, distance)))
    return null;
  return scoped((own) => {
    const k = getKernel();
    let current = body;
    let addedVolume = 0;
    for (const [i, c] of corners.entries()) {
      const tool = own(wedge(c!, distance));
      const op = own(
        new k.BRepAlgoAPI_Fuse_3(current.shape, tool, own(progress())),
      );
      op.Build(own(progress()));
      if (!op.IsDone()) return null;
      const shape = own(op.Shape());
      if (!isValidShape(shape)) return null;
      const toolNames = bevelNames(tool, c!, `f:${featureId}:fe:${i + 1}`);
      const names = propagateNames(
        op,
        [current, { shape: tool, names: toolNames }],
        shape,
        featureId,
      );
      toolNames.release();
      current = { bodyId: body.bodyId, shape, names };
      addedVolume += (V.norm(c!.delta) * distance * distance) / 2;
    }
    const count = (shape: Shape) => solids(shape).map(own).length;
    if (
      count(current.shape) !== count(body.shape) ||
      handles(current.shape) !== handles(body.shape)
    )
      return null;
    if (
      Math.abs(volumeOf(current.shape) - volumeOf(body.shape) - addedVolume) >
      LINEAR_TOL * Math.max(1, addedVolume)
    )
      return null;
    return {
      ...current,
      shape: current.shape.Oriented(current.shape.Orientation_1()),
    };
  });
}
