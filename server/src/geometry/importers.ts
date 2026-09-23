import crypto from "node:crypto";
import {
  newId,
  ValidationError,
  type Feature,
  type ImportStepFeature,
} from "@rockett/shared";
import { getKernel, solids, progress, type Shape } from "./kernel.js";

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

export function readImport(feature: ImportStepFeature): Shape {
  const k = getKernel(),
    reader = READERS[feature.format ?? "step"],
    file = `/rockett-import-${crypto.randomUUID()}.${reader.extension}`;
  let shape: Shape | undefined;
  try {
    k.FS.writeFile(file, feature.data);
    shape = reader.read(file);
  } finally {
    if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
  }
  if (shape && !shape.IsNull() && solids(shape).length > 0) return shape;
  shape?.delete();
  throw new Error(`No solid found in the ${reader.label} file.`);
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

export const IMPORTERS = [
  importer("step", [".step", ".stp"]),
  importer("iges", [".igs", ".iges"]),
  importer("brep", [".brep"]),
];

export const importerFor = (filename: string) =>
  IMPORTERS.find((i) =>
    i.extensions.some((e) => filename.toLowerCase().endsWith(e)),
  );
