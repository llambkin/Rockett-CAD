import { getKernel, progress } from "../../src/geometry/kernel.js";

export function stepFixture(twoBodies = false): string {
  const k = getKernel(),
    writer = new k.STEPControl_Writer_1(),
    file = "/fixture.step";
  const box = new k.BRepPrimAPI_MakeBox_2(20, 30, 10);
  try {
    writer.Transfer(
      box.Shape(),
      k.STEPControl_StepModelType.STEPControl_AsIs,
      true,
      progress(),
    );
    if (twoBodies) {
      const second = new k.BRepPrimAPI_MakeBox_2(5, 6, 7);
      writer.Transfer(
        second.Shape(),
        k.STEPControl_StepModelType.STEPControl_AsIs,
        true,
        progress(),
      );
      second.delete();
    }
    if (writer.Write(file) !== k.IFSelect_ReturnStatus.IFSelect_RetDone)
      throw new Error("fixture export failed");
    return k.FS.readFile(file, { encoding: "utf8" });
  } finally {
    writer.delete();
    box.delete();
    if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
  }
}
