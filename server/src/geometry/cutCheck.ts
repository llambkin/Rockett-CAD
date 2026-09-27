import { LINEAR_TOL } from "@rockett/shared";
import {
  faces,
  getKernel,
  listToArray,
  progress,
  scoped,
  type Shape,
} from "./kernel.js";

export const TOOL_OUTSIDE =
  "cut left the body inside out: the kernel kept faces of the cut outside the body; the previous body has been kept";

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

export function leavesToolOutside(op: any, tool: Shape, body: Shape): boolean {
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
