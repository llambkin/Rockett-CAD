import { edges, getKernel } from "../../src/geometry/kernel.js";
import { ShapeMap } from "../../src/geometry/shapeMap.js";

export function filletedCube(size: number, radius: number) {
  const k = getKernel();
  const box = new k.BRepPrimAPI_MakeBox_2(size, size, size);
  const op = new k.BRepFilletAPI_MakeFillet(
    box.Shape(),
    k.ChFi3d_FilletShape.ChFi3d_Rational,
  );
  for (const edge of edges(box.Shape())) op.Add_2(radius, edge);
  op.Build(new k.Message_ProgressRange_1());
  const body = {
    bodyId: "b",
    shape: op.Shape(),
    names: new ShapeMap<string>(),
  };
  op.delete();
  box.delete();
  return body;
}
