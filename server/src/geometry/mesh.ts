import {
  getKernel,
  faces as facesOf,
  release,
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
  const k = getKernel(),
    mesh = new k.Poly_Triangulation_2(3, 1, false, false),
    triangle = new k.Poly_Triangle_2(1, 2, 3);
  corners.forEach(([x, y, z], i) => {
    const at = new k.gp_Pnt_3(x, y, z);
    mesh.SetNode(i + 1, at);
    at.delete();
  });
  mesh.SetTriangle(1, triangle);
  mesh.SetMeshPurpose(EXACT);
  triangle.delete();
  const handle = new k.Handle_Poly_Triangulation_2(mesh);
  builder.UpdateFace_2(face, handle, true);
  handle.delete();
}

function isExact(face: Shape): boolean {
  const k = getKernel(),
    at = new k.TopLoc_Location_1(),
    mesh = k.BRep_Tool.Triangulation(face, at, EXACT),
    exact = !mesh.IsNull();
  mesh.delete();
  at.delete();
  return exact;
}

export function meshShape(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): FaceMesh[] {
  const k = getKernel(),
    faces = facesOf(shape);
  let meshes;
  try {
    if (!faces.every(isExact))
      new k.BRepMesh_IncrementalMesh_2(
        shape,
        linear,
        false,
        angular,
        false,
      ).delete();
    meshes = faces.map((face) => k.meshFace(face));
  } catch (error) {
    release(faces);
    throw error;
  }
  return faces.flatMap((face, i) => {
    const mesh = meshes[i];
    if (mesh) return [{ face, ...mesh }];
    face.delete();
    return [];
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
