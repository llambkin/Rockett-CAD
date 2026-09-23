import crypto from "node:crypto";
import {
  LINEAR_TOL,
  newId,
  ValidationError,
  type Feature,
  type ImportMeshFeature,
  type ImportStepFeature,
} from "@rockett/shared";
import {
  explore,
  getKernel,
  solids,
  progress,
  volumeOf,
  type Shape,
} from "./kernel.js";

type Format = NonNullable<ImportStepFeature["format"]> | "step";

interface Reader {
  label: string;
  extension: string;
  read(file: string): Shape | undefined;
}

function translate(reader: any, file: string): Shape | undefined {
  const k = getKernel();
  try {
    if (reader.ReadFile(file) !== k.IFSelect_ReturnStatus.IFSelect_RetDone)
      return undefined;
    reader.SetSystemLengthUnit?.(1);
    reader.TransferRoots(progress());
    return reader.OneShape();
  } finally {
    reader.delete();
  }
}

const READERS: Record<Format, Reader> = {
  step: {
    label: "STEP",
    extension: "step",
    read: (file) => translate(new (getKernel().STEPControl_Reader_1)(), file),
  },
  iges: {
    label: "IGES",
    extension: "igs",
    read: (file) => translate(new (getKernel().IGESControl_Reader_1)(), file),
  },
  brep: {
    label: "BREP",
    extension: "brep",
    read(file) {
      const k = getKernel(),
        shape = new k.TopoDS_Shape(),
        builder = new k.BRep_Builder();
      try {
        if (k.BRepTools.Read_2(shape, file, builder, progress())) return shape;
        shape.delete();
        return undefined;
      } finally {
        builder.delete();
      }
    },
  },
};

function withFile<T>(
  data: string | Uint8Array,
  extension: string,
  read: (file: string) => T,
): T {
  const k = getKernel(),
    file = `/rockett-import-${crypto.randomUUID()}.${extension}`;
  try {
    k.FS.writeFile(file, data);
    return read(file);
  } finally {
    if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
  }
}

export function readImport(feature: ImportStepFeature): Shape {
  const reader = READERS[feature.format ?? "step"],
    shape = withFile(feature.data, reader.extension, reader.read);
  if (shape && !shape.IsNull() && solids(shape).length > 0) return shape;
  shape?.delete();
  throw new Error(`No solid found in the ${reader.label} file.`);
}

export const MAX_MESH_TRIANGLES = 200_000;

type MeshFormat = ImportMeshFeature["format"];

const MESH_READERS: Record<
  MeshFormat,
  { label: string; read(file: string): any }
> = {
  stl: {
    label: "STL",
    read: (file) => getKernel().RWStl.ReadFile_2(file, progress()),
  },
  obj: {
    label: "OBJ",
    read: (file) => getKernel().RWObj.ReadFile(file, progress()),
  },
};

function markBinaryStl(bytes: Buffer) {
  if (bytes.length >= 84 && bytes.length === 84 + 50 * bytes.readUInt32LE(80))
    bytes[0] = 0xff;
}

function sewTriangles(mesh: any): { shape: Shape; openEdges: number } {
  const k = getKernel(),
    builder = new k.BRep_Builder(),
    sewing = new k.BRepBuilderAPI_Sewing(LINEAR_TOL, true, false, false, false),
    nodes: number[][] = [],
    owned: any[] = [builder, sewing],
    vertices: Shape[] = [],
    edges = new Map<number, Shape | null>(),
    count = mesh.NbNodes();
  const edge = (a: number, b: number): Shape | null => {
    const key = Math.min(a, b) * (count + 1) + Math.max(a, b);
    if (!edges.has(key)) {
      const make = new k.BRepBuilderAPI_MakeEdge_2(
        vertices[Math.min(a, b) - 1],
        vertices[Math.max(a, b) - 1],
      );
      edges.set(key, make.IsDone() ? make.Edge() : null);
      make.delete();
    }
    const found = edges.get(key)!;
    if (!found || a < b) return found;
    const reversed = k.TopoDS.Edge_1(found.Reversed());
    owned.push(reversed);
    return reversed;
  };
  try {
    for (let i = 1; i <= count; i++) {
      const p = mesh.Node(i),
        vertex = new k.BRepBuilderAPI_MakeVertex(p);
      nodes.push([p.X(), p.Y(), p.Z()]);
      vertices.push(vertex.Vertex());
      vertex.delete();
      p.delete();
    }
    for (let i = 1; i <= mesh.NbTriangles(); i++) {
      const t = mesh.Triangle(i),
        [a, b, c] = [t.Value(1), t.Value(2), t.Value(3)];
      t.delete();
      const [p, q, r] = [nodes[a - 1]!, nodes[b - 1]!, nodes[c - 1]!],
        u = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!],
        v = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!],
        n = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ],
        sides = [edge(a, b), edge(b, c), edge(c, a)];
      if (sides.includes(null) || Math.hypot(n[0]!, n[1]!, n[2]!) === 0)
        continue;
      const wire = new k.BRepBuilderAPI_MakeWire_4(...sides),
        origin = new k.gp_Pnt_3(p[0], p[1], p[2]),
        normal = new k.gp_Dir_4(n[0], n[1], n[2]),
        plane = new k.Handle_Geom_Surface_2(new k.Geom_Plane_3(origin, normal)),
        face = new k.TopoDS_Face();
      builder.MakeFace_2(face, plane, LINEAR_TOL);
      builder.Add(face, wire.Wire());
      sewing.Add(face);
      owned.push(wire, origin, normal, plane, face);
    }
    sewing.Perform(progress());
    return { shape: sewing.SewedShape(), openEdges: sewing.NbFreeEdges() };
  } finally {
    for (const shape of [...owned, ...vertices, ...edges.values()])
      shape?.delete();
  }
}

export function readMesh(feature: ImportMeshFeature): {
  shape: Shape;
  warning?: string;
} {
  const k = getKernel(),
    { label, read } = MESH_READERS[feature.format],
    bytes = Buffer.from(feature.data, "base64");
  if (feature.format === "stl") markBinaryStl(bytes);
  const handle = withFile(bytes, feature.format, read);
  try {
    const mesh = handle.IsNull() ? undefined : handle.get(),
      triangles: number = mesh?.NbTriangles() ?? 0;
    if (triangles === 0) throw new Error(`No mesh found in the ${label} file.`);
    if (triangles > MAX_MESH_TRIANGLES)
      throw new Error(
        `The ${label} mesh has ${triangles.toLocaleString("en-US")} triangles; the limit is ${MAX_MESH_TRIANGLES.toLocaleString("en-US")}.`,
      );
    const { shape, openEdges } = sewTriangles(mesh);
    if (openEdges > 0)
      return {
        shape,
        warning: `The ${label} mesh is open at ${openEdges} edges, so it imported as a shell, not a solid.`,
      };
    const builder = new k.BRep_Builder(),
      compound = new k.TopoDS_Compound();
    builder.MakeCompound(compound);
    for (const shell of explore(shape, "shell")) {
      const make = new k.BRepBuilderAPI_MakeSolid_3(k.TopoDS.Shell_1(shell)),
        solid = make.Solid();
      if (volumeOf(solid) < 0) solid.Reverse();
      builder.Add(compound, solid);
      make.delete();
    }
    builder.delete();
    shape.delete();
    return { shape: compound };
  } finally {
    handle.delete();
  }
}

function importer(format: Format, extensions: string[]) {
  return {
    format,
    label: READERS[format].label,
    extensions,
    read(bytes: Buffer, filename: string): Feature[] {
      const feature: ImportStepFeature = {
        id: newId("import"),
        type: "importStep",
        name: filename.slice(0, 120),
        suppressed: false,
        filename,
        ...(format !== "step" && { format }),
        data: bytes.toString("utf8").replace(/^\uFEFF/, ""),
      };
      try {
        readImport(feature).delete();
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
      return [feature];
    },
  };
}

function meshImporter(format: MeshFormat) {
  return {
    format,
    label: MESH_READERS[format].label,
    extensions: [`.${format}`],
    read(bytes: Buffer, filename: string): Feature[] {
      return [
        {
          id: newId("import"),
          type: "importMesh",
          name: filename.slice(0, 120),
          suppressed: false,
          filename,
          format,
          data: bytes.toString("base64"),
        },
      ];
    },
  };
}

export const IMPORTERS = [
  importer("step", [".step", ".stp"]),
  importer("iges", [".igs", ".iges"]),
  importer("brep", [".brep"]),
  meshImporter("stl"),
  meshImporter("obj"),
];

export const importerFor = (filename: string) =>
  IMPORTERS.find((i) =>
    i.extensions.some((e) => filename.toLowerCase().endsWith(e)),
  );
