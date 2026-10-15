import { beforeAll, expect, it } from "vitest";
import {
  faceCentroid,
  faces,
  getKernel,
  initKernel,
  planarFacePlane,
} from "../src/geometry/kernel.js";

beforeAll(initKernel, 120000);

it("orients the plane of a reversed face out of the solid", () => {
  const k = getKernel();
  const box = new k.BRepPrimAPI_MakeBox_2(20, 30, 10);
  const bottom = faces(box.Shape()).find((f) => faceCentroid(f)[2] === 0);

  const plane = planarFacePlane(bottom);

  expect(plane?.origin).toEqual([0, 0, 0]);
  expect(plane?.normal.map((c) => c + 0)).toEqual([0, 0, -1]);
  box.delete();
});

it("reports no plane for a cylinder side", () => {
  const k = getKernel();
  const cyl = new k.BRepPrimAPI_MakeCylinder_1(5, 10);
  const side = faces(cyl.Shape()).find((f) => faceCentroid(f)[2] === 5);

  expect(planarFacePlane(side)).toBeNull();
  cyl.delete();
});
