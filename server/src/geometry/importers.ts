import crypto from "node:crypto";
import {
  LINEAR_TOL,
  NAME_LENGTH,
  newId,
  roundedLength,
  ValidationError,
  type Feature,
  type ImportMeshFeature,
  type ImportStepFeature,
} from "@rockett/shared";
import {
  explore,
  acquire,
  bboxOf,
  edges as edgesOf,
  scoped,
  getKernel,
  faces,
  solids,
  progress,
  volumeOf,
  type Own,
  type Shape,
} from "./kernel.js";
import { readStep, type Solids } from "./stepImport.js";
import { read3mf, slim3mf } from "./read3mf.js";
import { sha256 } from "../store/jsonStore.js";
import { registerImporter } from "../api/importers.js";

export type Sources = ReadonlyMap<string, Uint8Array>;

type Format = NonNullable<ImportStepFeature["format"]> | "step";

type Reader = { label: string; read(data: Uint8Array): Solids | undefined };

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

export function solidsOf(sewn: Shape): Shape {
  const k = getKernel();
  return acquire(
    scoped((own) => {
      const builder = own(new k.BRep_Builder());
      const shells = [...explore(sewn, "shell")].map((shell) =>
        own(k.TopoDS.Shell_1(shell)),
      );
      const { TopAbs_FACE, TopAbs_SHELL } = k.TopAbs_ShapeEnum;
      const loose = own(
        new k.TopExp_Explorer_2(sewn, TopAbs_FACE, TopAbs_SHELL),
      );
      for (; loose.More(); loose.Next()) {
        const shell = own(new k.TopoDS_Shell());
        builder.MakeShell(shell);
        builder.Add(shell, own(loose.Current()));
        shells.push(shell);
      }
      const made = shells.map((shell) => {
        const solid = own(own(new k.BRepBuilderAPI_MakeSolid_3(shell)).Solid());
        if (volumeOf(solid) < 0) solid.Reverse();
        return solid;
      });
      return own.keep(own(compound(made)));
    }),
  );
}

function pointText(p: number[]): string {
  return `(${p.map((v) => roundedLength(v, "mm")).join(", ")})`;
}

const MAX_SEW_TOL = 0.01;

function sewTolerance(shape: Shape, own: Own): number {
  const k = getKernel();
  const widest = edgesOf(shape)
    .map(own)
    .reduce((most, edge) => Math.max(most, k.BRep_Tool.Tolerance_2(edge)), 0);
  return Math.min(MAX_SEW_TOL, Math.max(LINEAR_TOL, widest));
}

function sewFaces(shape: Shape | undefined, label: string): Shape | undefined {
  if (
    !shape ||
    shape.IsNull() ||
    solids(shape).length > 0 ||
    faces(shape).length === 0
  )
    return shape;
  const k = getKernel();
  return acquire(
    scoped((own) => {
      const sewing = own(
        new k.BRepBuilderAPI_Sewing(
          sewTolerance(shape, own),
          true,
          true,
          true,
          false,
        ),
      );
      sewing.Add(shape);
      sewing.Perform(progress());
      const open = sewing.NbFreeEdges();
      if (open === 0) return own.keep(solidsOf(own(sewing.SewedShape())));
      const free = Array.from({ length: open }, (_, i) =>
        own(sewing.FreeEdge(i + 1)),
      );
      const { min, max } = bboxOf(own(compound(free)), false);
      throw new Error(
        `The ${label} faces do not close into a solid: ${open} open edge${open === 1 ? "" : "s"} from ${pointText(min)} to ${pointText(max)} mm.`,
      );
    }),
  );
}

export function compound(shapes: Shape[]): Shape {
  const k = getKernel();
  return acquire(
    scoped((own) => {
      const builder = own(new k.BRep_Builder());
      const result = own(new k.TopoDS_Compound());
      builder.MakeCompound(result);
      for (const shape of shapes) builder.Add(result, shape);
      return own.keep(result);
    }),
  );
}

function fromFile(
  extension: string,
  read: (file: string) => Shape | undefined,
) {
  return (data: Uint8Array): Solids | undefined => {
    const shape = withFile(data, extension, read);
    if (!shape || shape.IsNull()) return;
    return { shape, parts: solids(shape).map((solid) => ({ shape: solid })) };
  };
}

const READERS: Record<Format, Reader> = {
  step: {
    label: "STEP",
    read(data) {
      const read = readStep(data);
      if (!read) return;
      const { shapes, parts, tree } = read;
      return { shape: compound(shapes), parts, tree };
    },
  },
  iges: {
    label: "IGES",
    read: fromFile("igs", (file) =>
      sewFaces(
        translate(new (getKernel().IGESControl_Reader_1)(), file),
        "IGES",
      ),
    ),
  },
  brep: {
    label: "BREP",
    read: fromFile("brep", (file) => {
      const k = getKernel();
      const result = scoped((own) => {
        const shape = own(new k.TopoDS_Shape());
        const builder = own(new k.BRep_Builder());
        if (k.BRepTools.Read_2(shape, file, builder, progress()))
          return own.keep(shape);
        return undefined;
      });
      return result && acquire(result);
    }),
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

export function sourceOf(
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
): Solids {
  const reader = READERS[feature.format ?? "step"],
    data = sourceOf(sources, feature, reader.label);
  const read = scoped((own) => {
    const found = reader.read(data);
    if (!found?.parts.length)
      throw new Error(`No solid found in the ${reader.label} file.`);
    for (const { shape } of [found, ...found.parts]) own.keep(shape);
    return found;
  });
  for (const { shape } of [read, ...read.parts]) acquire(shape);
  return read;
}

export const MAX_MESH_TRIANGLES = 1_000_000;

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

export const MESH_READERS: Record<
  MeshFormat,
  {
    label: string;
    read(bytes: Buffer): MeshPart[];
    source?(bytes: Buffer): Buffer;
  }
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
  "3mf": { label: "3MF", read: read3mf, source: slim3mf },
};

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
        scoped(() => readImport(feature, sources));
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
    read(upload: Buffer, filename: string): Imported {
      const bytes = MESH_READERS[format].source?.(upload) ?? upload,
        blob = sha256(bytes);
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
