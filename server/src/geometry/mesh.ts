import {
  getKernel,
  acquire,
  faces as facesOf,
  scoped,
  transformOp,
  type Own,
  type Shape,
} from "./kernel.js";
import { compound } from "./importers.js";

export interface FaceMesh {
  face: Shape;
  positions: Float64Array;
  normals: Float64Array;
  indices: Uint32Array;
}

const EXACT = 32;

export function setExactTriangle(
  builder: any,
  face: Shape,
  corners: number[][],
) {
  const k = getKernel();
  scoped((own) => {
    const mesh = own(new k.Poly_Triangulation_2(3, 1, false, false));
    corners.forEach(([x, y, z], i) =>
      mesh.SetNode(i + 1, own(new k.gp_Pnt_3(x, y, z))),
    );
    mesh.SetTriangle(1, own(new k.Poly_Triangle_2(1, 2, 3)));
    mesh.SetMeshPurpose(EXACT);
    mesh.IncrementRefCounter();
    let handle;
    try {
      handle = own(mesh.Copy());
    } finally {
      mesh.DecrementRefCounter();
    }
    builder.UpdateFace_2(face, handle, true);
  });
}

function isExact(face: Shape): boolean {
  const k = getKernel();
  return scoped((own) => {
    const at = own(new k.TopLoc_Location_1());
    const mesh = own(k.BRep_Tool.Triangulation(face, at, EXACT));
    return !mesh.IsNull();
  });
}

function reverseExact(face: Shape) {
  const k = getKernel();
  scoped((own) => {
    const at = own(new k.TopLoc_Location_1());
    const mesh = own(k.BRep_Tool.Triangulation(face, at, EXACT)).get();
    for (let i = 1; i <= mesh.NbTriangles(); i++) {
      const t = own(mesh.Triangle(i));
      mesh.SetTriangle(
        i,
        own(new k.Poly_Triangle_2(t.Value(1), t.Value(3), t.Value(2))),
      );
    }
  });
}

export function transformCopy(shape: Shape, trsf: any): any {
  const exact = scoped((own) => facesOf(shape).map(own).every(isExact));
  const op = transformOp(shape, trsf, exact);
  if (exact && trsf.IsNegative())
    scoped((own) => facesOf(own(op.Shape())).map(own).forEach(reverseExact));
  return op;
}

export function meshShape(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): FaceMesh[] {
  const k = getKernel();
  return scoped((own) => {
    const faces = facesOf(shape).map(own);
    const missing = faces.filter((face) => !isExact(face));
    const meshed =
      missing.length < faces.length ? own(compound(missing)) : shape;
    if (missing.length > 0)
      own(
        new k.BRepMesh_IncrementalMesh_2(meshed, linear, false, angular, false),
      );
    return faces.flatMap((face) => {
      const mesh = k.meshFace(face);
      if (!mesh) return [];
      own.keep(face);
      return [{ face, ...mesh }];
    });
  }).map((mesh) => {
    acquire(mesh.face);
    return mesh;
  });
}

function detached(
  own: Own,
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): Shape[] {
  const k = getKernel();
  const copy = own(
    own(new k.BRepBuilderAPI_Copy_2(shape, false, false)).Shape(),
  );
  own(new k.BRepMesh_IncrementalMesh_2(copy, linear, false, angular, false));
  return facesOf(copy).map(own);
}

export function meshDetached(
  shape: Shape,
  deflection: { linear: number; angular: number },
): FaceMesh[] {
  const k = getKernel();
  return scoped((own) => {
    const faces = facesOf(shape).map(own);
    if (faces.some(isExact)) return [];
    return detached(own, shape, deflection).flatMap((copied, i) => {
      const mesh = k.meshFace(copied);
      if (!mesh) return [];
      return [{ face: own.keep(faces[i]!), ...mesh }];
    });
  }).map((mesh) => {
    acquire(mesh.face);
    return mesh;
  });
}

export function meshCopy(
  shape: Shape,
  deflection: { linear: number; angular: number },
): Omit<FaceMesh, "face">[] {
  const k = getKernel();
  return scoped((own) => {
    const faces = facesOf(shape).map(own);
    const meshed = faces.every(isExact)
      ? faces
      : detached(own, shape, deflection);
    return meshed.flatMap((face) => k.meshFace(face) ?? []);
  });
}
