import { beforeAll, expect, it } from "vitest";
import type { Vec3 } from "@rockett/shared";
import { getKernel, initKernel } from "../src/geometry/kernel.js";
import { meshShape } from "../src/geometry/mesh.js";
import { tessellateBody } from "../src/geometry/tessellate.js";
import { writeStl } from "../src/geometry/exporters.js";
import { ShapeMap } from "../src/geometry/shapeMap.js";

beforeAll(initKernel, 120000);

it("meshes a box once for the viewport and STL at equal deflection", () => {
  const k = getKernel();
  const box = new k.BRepPrimAPI_MakeBox_2(20, 30, 10);
  const body = {
    bodyId: "b",
    shape: box.Shape(),
    names: new ShapeMap<string>(),
  };
  const deflection = { linear: 0.05, angular: 0.3 };

  const faces = meshShape(body.shape, deflection);
  const triangles = faces.reduce((n, f) => n + f.indices.length / 3, 0);
  const payload = tessellateBody(
    body,
    { name: "Box", visible: true },
    deflection,
  );
  const stl = writeStl([body], deflection.linear);

  expect(faces).toHaveLength(6);
  expect(triangles).toBe(12);
  expect(payload.indices.length / 3).toBe(triangles);
  expect(stl.readUInt32LE(80)).toBe(triangles);

  for (const { positions: P, normals: N, indices: I } of faces) {
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t]! * 3, I[t + 1]! * 3, I[t + 2]! * 3];
      const u: Vec3 = [
        P[b]! - P[a]!,
        P[b + 1]! - P[a + 1]!,
        P[b + 2]! - P[a + 2]!,
      ];
      const v: Vec3 = [
        P[c]! - P[a]!,
        P[c + 1]! - P[a + 1]!,
        P[c + 2]! - P[a + 2]!,
      ];
      const n: Vec3 = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      expect(
        n[0] * N[a]! + n[1] * N[a + 1]! + n[2] * N[a + 2]!,
      ).toBeGreaterThan(0);
    }
  }
  box.delete();
});
