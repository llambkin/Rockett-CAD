import crypto from "node:crypto";
import {
  LINEAR_TOL,
  NAME_LENGTH,
  newId,
  ValidationError,
  type Feature,
  type ImportMeshFeature,
  type ImportStepFeature,
} from "@rockett/shared";
import {
  explore,
  acquire,
  scoped,
  getKernel,
  solids,
  progress,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { setExactTriangle } from "./mesh.js";
import { read3mf } from "./read3mf.js";
import { sha256 } from "../store/jsonStore.js";
import { registerImporter } from "../api/importers.js";

export type Sources = ReadonlyMap<string, Uint8Array>;

type Format = NonNullable<ImportStepFeature["format"]> | "step";

interface Reader {
  label: string;
  extension: string;
  read(file: string): Shape | undefined;
}

function translate(reader: any, file: string): Shape | undefined {
  const k = getKernel();
  const result = scoped((own) => {
    own(reader);
    if (reader.ReadFile(file) !== k.IFSelect_ReturnStatus.IFSelect_RetDone)
      return undefined;
    reader.SetSystemLengthUnit?.(1);
    reader.TransferRoots(progress());
    return own.keep(own(reader.OneShape()));
  });
  return result && acquire(result);
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
      const k = getKernel();
      const result = scoped((own) => {
        const shape = own(new k.TopoDS_Shape());
        const builder = own(new k.BRep_Builder());
        if (k.BRepTools.Read_2(shape, file, builder, progress()))
          return own.keep(shape);
        return undefined;
      });
      return result && acquire(result);
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

function sourceOf(
  sources: Sources,
  feature: ImportStepFeature | ImportMeshFeature,
  label: string,
): Uint8Array {
  const data = sources.get(feature.blob);
  if (!data)
    throw new Error(
      `The ${label} source of ${feature.filename} is missing or damaged.`,
    );
  return data;
}

export function readImport(
  feature: ImportStepFeature,
  sources: Sources,
): Shape {
  const reader = READERS[feature.format ?? "step"],
    data = sourceOf(sources, feature, reader.label);
  return acquire(
    scoped((own) => {
      const shape = withFile(data, reader.extension, reader.read);
      if (shape) own(shape);
      if (shape && !shape.IsNull() && solids(shape).length > 0)
        return own.keep(shape);
      throw new Error(`No solid found in the ${reader.label} file.`);
    }),
  );
}

export const MAX_MESH_TRIANGLES = 200_000;

type MeshFormat = ImportMeshFeature["format"];

export interface MeshPart {
  nodes: ArrayLike<number>;
  triangles: ArrayLike<number>;
  transform?: number[];
}

function triangulation(handle: any): MeshPart {
  return scoped((own) => {
    own(handle);
    const { positions, indices } = getKernel().meshTriangulation(handle);
    return { nodes: positions, triangles: indices };
  });
}

function markBinaryStl(bytes: Buffer) {
  if (bytes.length >= 84 && bytes.length === 84 + 50 * bytes.readUInt32LE(80))
    bytes[0] = 0xff;
}

const MESH_READERS: Record<
  MeshFormat,
  { label: string; read(bytes: Buffer): MeshPart[] }
> = {
  stl: {
    label: "STL",
    read(bytes) {
      markBinaryStl(bytes);
      return [
        withFile(bytes, "stl", (file) =>
          triangulation(getKernel().RWStl.ReadFile_2(file, progress())),
        ),
      ];
    },
  },
  obj: {
    label: "OBJ",
    read: (bytes) => [
      withFile(bytes, "obj", (file) =>
        triangulation(getKernel().RWObj.ReadFile(file, progress())),
      ),
    ],
  },
  "3mf": { label: "3MF", read: read3mf },
};

function attachTriangle(
  builder: any,
  sewing: any,
  sides: (Shape | null)[],
  corners: number[][],
  normalVector: number[],
): void {
  const k = getKernel();
  scoped((local) => {
    const wire = local(new k.BRepBuilderAPI_MakeWire_4(...sides));
    const origin = local(new k.gp_Pnt_3(...corners[0]!));
    const normal = local(new k.gp_Dir_5(...normalVector));
    const plane = local(new k.gp_Pln_3(origin, normal));
    const make = local(new k.BRepBuilderAPI_MakeFace_3(plane));
    const face = local(make.Face());
    builder.UpdateFace_3(face, LINEAR_TOL);
    setExactTriangle(builder, face, corners);
    builder.Add(face, local(wire.Wire()));
    sewing.Add(face);
  });
}

function sewTriangles({ nodes, triangles, transform: m }: MeshPart): {
  shape: Shape;
  openEdges: number;
} {
  const k = getKernel();
  const result = scoped((own) => {
    const builder = own(new k.BRep_Builder());
    const sewing = own(
      new k.BRepBuilderAPI_Sewing(LINEAR_TOL, true, false, false, false),
    );
    const vertices = new Map<number, Shape>();
    const edges = new Map<number, Shape | null>();
    const count = nodes.length / 3;
    const point = (i: number): number[] => {
      const [x, y, z] = [nodes[3 * i]!, nodes[3 * i + 1]!, nodes[3 * i + 2]!];
      if (!m) return [x, y, z];
      return [0, 1, 2].map(
        (axis) =>
          x * m[axis]! + y * m[3 + axis]! + z * m[6 + axis]! + m[9 + axis]!,
      );
    };
    const vertex = (i: number): Shape => {
      if (!vertices.has(i)) {
        const made = scoped((local) => {
          const p = point(i);
          const at = local(new k.gp_Pnt_3(p[0], p[1], p[2]));
          const make = local(new k.BRepBuilderAPI_MakeVertex(at));
          return local.keep(local(make.Vertex()));
        });
        vertices.set(i, own(made));
      }
      return vertices.get(i)!;
    };
    const edge = (a: number, b: number): Shape | null => {
      const key = Math.min(a, b) * count + Math.max(a, b);
      if (!edges.has(key)) {
        const made = scoped((local) => {
          const make = local(
            new k.BRepBuilderAPI_MakeEdge_2(
              vertex(Math.min(a, b)),
              vertex(Math.max(a, b)),
            ),
          );
          return make.IsDone() ? local.keep(local(make.Edge())) : null;
        });
        edges.set(key, made && own(made));
      }
      const found = edges.get(key)!;
      if (!found || a < b) return found;
      return own(
        scoped((local) =>
          local.keep(local(k.TopoDS.Edge_1(local(found.Reversed())))),
        ),
      );
    };
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!],
        [p, q, r] = [point(a), point(b), point(c)],
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
      attachTriangle(builder, sewing, sides, [p, q, r], n);
    }
    sewing.Perform(progress());
    return {
      shape: own.keep(own(sewing.SewedShape())),
      openEdges: sewing.NbFreeEdges(),
    };
  });
  acquire(result.shape);
  return result;
}

export function readMesh(
  feature: ImportMeshFeature,
  sources: Sources,
): {
  shape: Shape;
  warning?: string;
} {
  const k = getKernel(),
    { label, read } = MESH_READERS[feature.format],
    parts = read(Buffer.from(sourceOf(sources, feature, label))).filter(
      (part) => part.triangles.length > 0,
    ),
    triangles = parts.reduce((sum, part) => sum + part.triangles.length / 3, 0);
  if (triangles === 0) throw new Error(`No mesh found in the ${label} file.`);
  if (triangles > MAX_MESH_TRIANGLES)
    throw new Error(
      `The ${label} mesh has ${triangles.toLocaleString("en-US")} triangles; the limit is ${MAX_MESH_TRIANGLES.toLocaleString("en-US")}.`,
    );
  const result = scoped((own) => {
    const builder = own(new k.BRep_Builder());
    const sewn = own(new k.TopoDS_Compound());
    let openEdges = 0;
    builder.MakeCompound(sewn);
    for (const part of parts) {
      const partShape = sewTriangles(part);
      builder.Add(sewn, partShape.shape);
      openEdges += partShape.openEdges;
    }
    if (openEdges > 0)
      return {
        shape: own.keep(sewn),
        warning: `The ${label} mesh is open at ${openEdges} edges, so it imported as a shell, not a solid.`,
      };
    const compound = own(new k.TopoDS_Compound());
    builder.MakeCompound(compound);
    for (const shell of explore(sewn, "shell")) {
      const make = own(
        new k.BRepBuilderAPI_MakeSolid_3(own(k.TopoDS.Shell_1(shell))),
      );
      const solid = own(make.Solid());
      if (volumeOf(solid) < 0) solid.Reverse();
      builder.Add(compound, solid);
    }
    return { shape: own.keep(compound) };
  });
  acquire(result.shape);
  return result;
}

interface Imported {
  features: Feature[];
  sources: Map<string, Buffer>;
}

function importer(format: Format, extensions: string[]) {
  registerImporter({
    format,
    label: READERS[format].label,
    extensions,
    read(bytes: Buffer, filename: string): Imported {
      const source = Buffer.from(
          bytes.toString("utf8").replace(/^\uFEFF/, ""),
          "utf8",
        ),
        blob = sha256(source),
        sources = new Map([[blob, source]]),
        feature: ImportStepFeature = {
          id: newId("import"),
          type: "importStep",
          name: filename.slice(0, NAME_LENGTH),
          suppressed: false,
          filename,
          ...(format !== "step" && { format }),
          blob,
        };
      try {
        scoped((own) => own(readImport(feature, sources)));
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
      return { features: [feature], sources };
    },
  });
}

function meshImporter(format: MeshFormat) {
  registerImporter({
    format,
    label: MESH_READERS[format].label,
    extensions: [`.${format}`],
    read(bytes: Buffer, filename: string): Imported {
      const blob = sha256(bytes);
      return {
        features: [
          {
            id: newId("import"),
            type: "importMesh",
            name: filename.slice(0, NAME_LENGTH),
            suppressed: false,
            filename,
            format,
            blob,
          },
        ],
        sources: new Map([[blob, bytes]]),
      };
    },
  });
}

importer("step", [".step", ".stp"]);
importer("iges", [".igs", ".iges"]);
importer("brep", [".brep"]);
meshImporter("stl");
meshImporter("obj");
meshImporter("3mf");
