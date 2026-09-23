import { getKernel, solids, progress, type Shape } from "./kernel.js";

/** Read exact B-Rep geometry using OCCT's STEP translator, in millimetres. */
export function readStep(data: string): Shape {
  const k = getKernel(),
    file = "/rockett-import.step";
  const reader = new k.STEPControl_Reader_1();
  try {
    k.FS.writeFile(file, data);
    if (reader.ReadFile(file) !== k.IFSelect_ReturnStatus.IFSelect_RetDone)
      throw new Error(
        "The STEP file could not be read. Check that it is a valid .step or .stp file.",
      );
    reader.SetSystemLengthUnit(1);
    if (reader.TransferRoots(progress()) < 1)
      throw new Error("The STEP file contains no transferable geometry.");
    const shape = reader.OneShape();
    if (shape.IsNull() || solids(shape).length === 0) {
      shape.delete();
      throw new Error(
        "This STEP file contains no solid bodies. Surface-only STEP files are not supported yet.",
      );
    }
    return shape;
  } finally {
    reader.delete();
    if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
  }
}
