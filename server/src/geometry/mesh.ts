import {
  getKernel,
  acquire,
  faces as facesOf,
  scoped,
  type Shape,
} from "./kernel.js";

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

export function meshShape(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): FaceMesh[] {
  const k = getKernel();
  return scoped((own) => {
    const faces = facesOf(shape).map(own);
    if (!faces.every(isExact))
      own(
        new k.BRepMesh_IncrementalMesh_2(shape, linear, false, angular, false),
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

export function meshCopy(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): Omit<FaceMesh, "face">[] {
  const k = getKernel();
  return scoped((own) => {
    let faces = facesOf(shape).map(own);
    if (!faces.every(isExact)) {
      const copy = own(
        own(new k.BRepBuilderAPI_Copy_2(shape, false, false)).Shape(),
      );
      own(
        new k.BRepMesh_IncrementalMesh_2(copy, linear, false, angular, false),
      );
      faces = facesOf(copy).map(own);
    }
    return faces.flatMap((face) => k.meshFace(face) ?? []);
  });
}
