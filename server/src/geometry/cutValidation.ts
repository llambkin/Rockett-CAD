import { planarInteriorPoints } from "./planeBoundary.js";
import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import {
  acquire,
  areaOf,
  bboxOf,
  faces,
  getKernel,
  listToArray,
  progress,
  planarFacePlane,
  scoped,
  vertices,
  volumeAbout,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { compound } from "./importers.js";
import { V } from "./frames.js";

const TOOL_OUTSIDE =
  "cut left the body inside out: the kernel kept faces of the cut outside the body; the previous body has been kept";
const CUT_EMPTY =
  "cut removed the whole body: the kernel returned no solid; the previous body has been kept";
export const CUT_OVERREACH =
  "cut removed more than its tool holds: the kernel dropped part of the body; the previous body has been kept";

export const meshCutRefused = (triangles: number, limit: number) =>
  `cut through a mesh of ${triangles.toLocaleString("en-US")} triangles needs more memory than the kernel has: a cut can take a mesh of up to ${limit.toLocaleString("en-US")} triangles; the previous body has been kept`;

const SPREAD = [0.5, 0.25, 0.75, 0.1, 0.9];

export function interiorUV(face: Shape, surface: any): [number, number] | null {
  const k = getKernel();
  return scoped((own) => {
    const u0 = surface.FirstUParameter();
    const v0 = surface.FirstVParameter();
    const du = surface.LastUParameter() - u0;
    const dv = surface.LastVParameter() - v0;
    for (const s of SPREAD)
      for (const t of SPREAD) {
        const u = u0 + s * du;
        const v = v0 + t * dv;
        const where = own(
          new k.BRepClass_FaceClassifier_3(
            face,
            own(new k.gp_Pnt2d_3(u, v)),
            LINEAR_TOL,
            false,
            0.1,
          ),
        );
        if (where.State() === k.TopAbs_State.TopAbs_IN) return [u, v];
      }
    return null;
  });
}

function interiorPoint(face: Shape): Shape | null {
  const k = getKernel();
  const result = scoped((own) => {
    const surface = own(new k.BRepAdaptor_Surface_2(face, true));
    const uv = interiorUV(face, surface);
    return uv && own.keep(own(surface.Value(...uv)));
  });
  return result && acquire(result);
}

interface Surroundings {
  faces: Shape[];
  boxes: { min: Vec3; max: Vec3 }[];
}

function reach(p: Vec3, { min, max }: Surroundings["boxes"][number]) {
  const gap = [0, 1, 2].map((i) =>
    Math.max(min[i]! - p[i]!, 0, p[i]! - max[i]!),
  );
  const far = [0, 1, 2].map((i) =>
    Math.max(Math.abs(p[i]! - min[i]!), Math.abs(p[i]! - max[i]!)),
  );
  return { gap: V.norm(gap as Vec3), far: V.norm(far as Vec3) };
}

function sideOf(
  { faces: all, boxes }: Surroundings,
  at: any,
  tolerance: number,
): boolean | undefined {
  const k = getKernel();
  const p: Vec3 = [at.X(), at.Y(), at.Z()];
  const reaches = boxes.map((box) => reach(p, box));
  const bound = reaches.reduce((low, { far }) => Math.min(low, far), Infinity);
  const near = all.filter((_, i) => reaches[i]!.gap <= bound);
  return scoped((own) => {
    const vertex = own(own(new k.BRepBuilderAPI_MakeVertex(at)).Vertex());
    const dist = own(
      new k.BRepExtrema_DistShapeShape_2(
        own(compound(near)),
        vertex,
        k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
        k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
        progress(),
      ),
    );
    if (!dist.IsDone()) return undefined;
    const d = dist.Value();
    if (d <= tolerance) return false;
    for (let n = 1; n <= dist.NbSolution(); n++) {
      const support = own(dist.SupportOnShape1(n));
      if (support.ShapeType() !== k.TopAbs_ShapeEnum.TopAbs_FACE) continue;
      const plane = planarFacePlane(own(k.TopoDS.Face_1(support)));
      const q = own(dist.PointOnShape1(n));
      const along =
        plane && V.dot(V.sub(p, [q.X(), q.Y(), q.Z()]), plane.normal);
      if (along && Math.abs(along) >= d - LINEAR_TOL) return along > 0;
    }
    return undefined;
  });
}

function outside(
  solid: Shape,
  face: Shape,
  surroundings: () => Surroundings,
): boolean {
  const k = getKernel();
  return scoped((own) => {
    const points = planarFacePlane(face)
      ? planarInteriorPoints(face, own)
      : [interiorPoint(face)];
    const tolerance = Math.max(
      LINEAR_TOL,
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum.TopAbs_VERTEX),
    );
    return points.some((at) => {
      if (!at) return false;
      own(at);
      const side = sideOf(surroundings(), at, tolerance);
      if (side !== undefined) return side;
      const vertex = own(own(new k.BRepBuilderAPI_MakeVertex(at)).Vertex());
      const dist = own(
        new k.BRepExtrema_DistShapeShape_2(
          solid,
          vertex,
          k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
          k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
          progress(),
        ),
      );
      if (!dist.IsDone()) throw new Error("cut check failed");
      return !dist.InnerSolution() && dist.Value() > tolerance;
    });
  });
}

function leavesToolOutside(op: any, tool: Shape, body: Shape): boolean {
  const k = getKernel();
  return scoped((own) => {
    let known: Surroundings | undefined;
    const surroundings = () => {
      if (known) return known;
      const all = scoped((inner) => faces(body).map(inner.keep)).map(own);
      return (known = { faces: all, boxes: all.map((f) => bboxOf(f)) });
    };
    return faces(tool)
      .map(own)
      .filter((face) => !op.IsDeleted(face))
      .flatMap((face) => {
        const pieces = listToArray(op.Modified(face)).map(own);
        return pieces.length > 0
          ? pieces.map((piece) => own(k.TopoDS.Face_1(piece)))
          : [face];
      })
      .some((face) => outside(body, face, surroundings));
  });
}

function vertexMean(shape: Shape): [number, number, number] {
  return scoped(() => {
    const k = getKernel();
    const all = vertices(shape);
    const sum: [number, number, number] = [0, 0, 0];
    for (const vertex of all)
      scoped((own) => {
        const p = own(k.BRep_Tool.Pnt(vertex));
        sum[0] += p.X();
        sum[1] += p.Y();
        sum[2] += p.Z();
      });
    const n = all.length;
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  });
}

export function removesVolume(
  op: any,
  body: Shape,
  tool: Shape,
  result: Shape,
): boolean {
  if (leavesToolOutside(op, tool, body)) throw new Error(TOOL_OUTSIDE);
  const skin = LINEAR_TOL * (areaOf(body) + areaOf(tool));
  const at = vertexMean(body);
  const kept = volumeAbout(result, at);
  if (kept <= skin) throw new Error(CUT_EMPTY);
  const removed = volumeAbout(body, at) - kept;
  if (removed > Math.abs(volumeOf(tool)) + skin) throw new Error(CUT_OVERREACH);
  return removed > skin;
}
