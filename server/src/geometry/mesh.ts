import { getKernel, faces as facesOf, type Shape } from "./kernel.js";

export interface FaceMesh {
  face: Shape;
  positions: number[];
  normals: number[];
  indices: number[];
}

export function meshShape(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): FaceMesh[] {
  const k = getKernel();
  new k.BRepMesh_IncrementalMesh_2(
    shape,
    linear,
    false,
    angular,
    false,
  ).delete();

  const out: FaceMesh[] = [];
  for (const face of facesOf(shape)) {
    const loc = new k.TopLoc_Location_1();
    const triHandle = k.BRep_Tool.Triangulation(face, loc, 0);
    if (triHandle.IsNull()) {
      loc.delete();
      triHandle.delete();
      continue;
    }
    const tri = triHandle.get();
    const trsf = loc.Transformation();
    const sgn =
      face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    tri.ComputeNormals();
    for (let i = 1; i <= tri.NbNodes(); i++) {
      const p = tri.Node(i).Transformed(trsf);
      positions.push(p.X(), p.Y(), p.Z());
      p.delete();
      const d = tri.Normal_1(i).Transformed(trsf);
      normals.push(sgn * d.X(), sgn * d.Y(), sgn * d.Z());
      d.delete();
    }
    for (let i = 1; i <= tri.NbTriangles(); i++) {
      const t = tri.Triangle(i);
      const a = t.Value(1) - 1,
        b = t.Value(2) - 1,
        c = t.Value(3) - 1;
      t.delete();
      indices.push(...(sgn < 0 ? [a, c, b] : [a, b, c]));
    }
    out.push({ face, positions, normals, indices });

    trsf.delete();
    loc.delete();
    triHandle.delete();
  }
  return out;
}
