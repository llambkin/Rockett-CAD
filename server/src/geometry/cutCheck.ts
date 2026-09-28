import { LINEAR_TOL } from "@rockett/shared";
import {
  areaOf,
  edges,
  explore,
  faces,
  getKernel,
  listToArray,
  progress,
  release,
  scoped,
  shapeHash,
  shapeList,
  vertices,
  volumeAbout,
  volumeOf,
  type Shape,
} from "./kernel.js";

export const TOOL_OUTSIDE =
  "cut left the body inside out: the kernel kept faces of the cut outside the body; the previous body has been kept";
export const CUT_EMPTY =
  "cut removed the whole body: the kernel returned no solid; the previous body has been kept";
export const CUT_OVERREACH =
  "cut removed more than its tool holds: the kernel dropped part of the body; the previous body has been kept";

const SPREAD = [0.5, 0.25, 0.75, 0.1, 0.9];

function interiorPoint(face: Shape): Shape | null {
  const k = getKernel();
  return scoped((own) => {
    const surface = own(new k.BRepAdaptor_Surface_2(face, true));
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
        if (where.State() === k.TopAbs_State.TopAbs_IN)
          return surface.Value(u, v);
      }
    return null;
  });
}

function outside(solid: Shape, face: Shape): boolean {
  const k = getKernel();
  return scoped((own) => {
    const at = interiorPoint(face);
    if (!at) return false;
    own(at);
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
    const tolerance = Math.max(
      LINEAR_TOL,
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum.TopAbs_VERTEX),
    );
    return !dist.InnerSolution() && dist.Value() > tolerance;
  });
}

function leavesToolOutside(op: any, tool: Shape, body: Shape): boolean {
  const k = getKernel();
  return scoped((own) =>
    faces(tool)
      .map(own)
      .filter((face) => !op.IsDeleted(face))
      .flatMap((face) => {
        const pieces = listToArray(op.Modified(face)).map(own);
        return pieces.length > 0
          ? pieces.map((piece) => own(k.TopoDS.Face_1(piece)))
          : [face];
      })
      .some((face) => outside(body, face)),
  );
}

function vertexMean(shape: Shape): [number, number, number] {
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
  release(all);
  const n = all.length;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

function rejectCut(op: any, body: Shape, tool: Shape, result: Shape): void {
  if (leavesToolOutside(op, tool, body)) throw new Error(TOOL_OUTSIDE);
  const skin = LINEAR_TOL * (areaOf(body) + areaOf(tool));
  const at = vertexMean(body);
  const kept = volumeAbout(result, at);
  if (kept <= skin) throw new Error(CUT_EMPTY);
  if (volumeAbout(body, at) - kept > Math.abs(volumeOf(tool)) + skin)
    throw new Error(CUT_OVERREACH);
}

export function checkedCut(body: Shape, tool: Shape, failed: string): any {
  const op = new (getKernel().BRepAlgoAPI_Cut_3)(body, tool, progress());
  try {
    if (!op.IsDone()) throw new Error(failed);
    scoped((own) => rejectCut(op, body, tool, own(op.Shape())));
    return op;
  } catch (err) {
    op.delete();
    throw err;
  }
}

const CONTACT = 0.01;

interface Patch {
  face: Shape;
  edges: Set<number>;
  tolerance: number;
  box: any;
}

function shellCount(shape: Shape): number {
  const shells = [...explore(shape, "shell")];
  release(shells);
  return shells.length;
}

function generatedBy(op: any, sourceEdges: { edge: Shape }[]): Set<number> {
  const made = new Set<number>();
  for (const { edge } of sourceEdges) {
    const ends = vertices(edge);
    for (const from of [edge, ...ends]) {
      const generated = listToArray(op.Generated(from));
      for (const shape of generated) made.add(shapeHash(shape));
      release(generated);
    }
    release(ends);
  }
  return made;
}

function patch(face: Shape, box: any): Patch {
  const k = getKernel();
  const tolerance = Math.max(
    ...["VERTEX", "EDGE", "FACE"].map((type) =>
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum[`TopAbs_${type}`]),
    ),
  );
  if (tolerance > CONTACT) k.BRepBndLib.AddOptimal(face, box, false, false);
  else k.BRepBndLib.Add(face, box, true);
  box.Enlarge(CONTACT);
  const around = edges(face);
  const hashes = new Set(around.map(shapeHash));
  release(around);
  return { face, edges: hashes, tolerance, box };
}

function touches(a: Patch, b: Patch): boolean {
  return [...a.edges].some((edge) => b.edges.has(edge));
}

function near(a: Patch, b: Patch): boolean {
  if (a.box.IsOut_4(b.box)) return false;
  if (a.tolerance + b.tolerance <= CONTACT) return true;
  const k = getKernel();
  return scoped((own) => {
    const dist = own(
      new k.BRepExtrema_DistShapeShape_2(
        a.face,
        b.face,
        k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
        k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
        progress(),
      ),
    );
    return !dist.IsDone() || dist.Value() <= CONTACT;
  });
}

function crosses(face: Shape, others: Shape[]): boolean | null {
  const k = getKernel();
  return scoped((own) => {
    const builder = own(new k.BRep_Builder());
    const rest = own(new k.TopoDS_Compound());
    builder.MakeCompound(rest);
    for (const other of others) builder.Add(rest, other);
    const fuse = own(new k.BRepAlgoAPI_BuilderAlgo_1());
    fuse.SetArguments(own(shapeList([face, rest])));
    fuse.SetNonDestructive(true);
    fuse.Build(progress());
    if (fuse.HasErrors()) return null;
    return !own(fuse.SectionEdges()).IsEmpty();
  });
}

export function cutsThrough(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  before: Shape,
): boolean | null {
  if (shellCount(result) !== shellCount(before)) return true;
  if (!op) return false;
  const made = generatedBy(op, sourceEdges);
  const k = getKernel();
  return scoped((own) => {
    const all = faces(result).map((face) =>
      patch(own(face), own(new k.Bnd_Box_1())),
    );
    const blend = all.filter((p) => made.has(shapeHash(p.face)));
    const rest = all.filter(
      (p) => !made.has(shapeHash(p.face)) && !blend.some((b) => touches(p, b)),
    );
    for (const [n, a] of blend.entries()) {
      const partners = [...blend.slice(n + 1), ...rest].filter(
        (b) => !touches(a, b) && near(a, b),
      );
      if (partners.length === 0) continue;
      const verdict = crosses(
        a.face,
        partners.map((b) => b.face),
      );
      if (verdict !== false) return verdict;
    }
    return false;
  });
}
