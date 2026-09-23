import { beforeAll, expect, it } from "vitest";
import {
  faces,
  getKernel,
  initKernel,
  shapeHash,
} from "../src/geometry/kernel.js";
import { finalizeNames, type NameMap } from "../src/geometry/naming.js";

beforeAll(initKernel, 120_000);

function withCollidingHash<T>(run: () => T): T {
  const proto = getKernel().TopoDS_Shape.prototype;
  const hashCode = proto.HashCode;
  proto.HashCode = () => 1;
  try {
    return run();
  } finally {
    proto.HashCode = hashCode;
  }
}

it("faces() of a box keeps one of six faces when their hashes collide", () => {
  const box = new (getKernel().BRepPrimAPI_MakeBox_2)(20, 30, 10);

  expect(faces(box.Shape())).toHaveLength(6);
  expect(withCollidingHash(() => faces(box.Shape()))).toHaveLength(1);
  box.delete();
});

it("finalizeNames keeps one name for six faces when their hashes collide", () => {
  const box = new (getKernel().BRepPrimAPI_MakeBox_2)(20, 30, 10);
  const six = faces(box.Shape());

  const names = withCollidingHash(() => {
    const provisional: NameMap = new Map();
    six.forEach((f, i) => provisional.set(shapeHash(f), `f:box:${i + 1}`));
    return finalizeNames(box.Shape(), provisional, "box");
  });

  expect(six).toHaveLength(6);
  expect(names.size).toBe(1);
  box.delete();
});
