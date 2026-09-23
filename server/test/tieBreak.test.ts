import { beforeAll, expect, it } from "vitest";
import {
  dir,
  faceCentroid,
  getKernel,
  initKernel,
  pnt,
  shapeHash,
} from "../src/geometry/kernel.js";
import { finalizeNames, type NameMap } from "../src/geometry/naming.js";

beforeAll(initKernel, 120_000);

function square(x: number, y: number) {
  const k = getKernel();
  const plane = new k.gp_Pln_3(pnt(x, y, 0), dir(0, 0, 1));
  const make = new k.BRepBuilderAPI_MakeFace_9(plane, -4, 4, -4, 4);
  const face = make.Face();
  make.delete();
  plane.delete();
  return face;
}

function namesWithNoise(noise: number) {
  const k = getKernel();
  const low = square(0, 0);
  const high = square(noise, 10);
  const builder = new k.BRep_Builder();
  const pair = new k.TopoDS_Compound();
  builder.MakeCompound(pair);
  builder.Add(pair, low);
  builder.Add(pair, high);
  const provisional: NameMap = new Map([
    [shapeHash(low), "f:pad:cap:end"],
    [shapeHash(high), "f:pad:cap:end"],
  ]);

  const names = finalizeNames(pair, provisional, "pad");
  const gap = faceCentroid(high).map((c, i) => c - faceCentroid(low)[i]!);
  builder.delete();
  return {
    gap,
    low: names.get(shapeHash(low)),
    high: names.get(shapeHash(high)),
  };
}

it("orders two faces 10 mm apart in y by 1e-12 mm of x noise", () => {
  const ahead = namesWithNoise(1e-12);
  const behind = namesWithNoise(-1e-12);

  expect(ahead.gap[0]).toBeCloseTo(1e-12, 15);
  expect(behind.gap[0]).toBeCloseTo(-1e-12, 15);
  expect(ahead.gap[1]).toBeCloseTo(10, 12);
  expect(ahead).toMatchObject({
    low: "f:pad:cap:end~1",
    high: "f:pad:cap:end~2",
  });
  expect(behind).toMatchObject({
    low: "f:pad:cap:end~2",
    high: "f:pad:cap:end~1",
  });
});
