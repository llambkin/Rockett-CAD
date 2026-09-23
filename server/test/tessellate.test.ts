import { beforeAll, expect, it } from "vitest";
import { initKernel } from "../src/geometry/kernel.js";
import { exportMesh } from "../src/geometry/exporters.js";
import {
  tessellateBody,
  type TessellationOptions,
} from "../src/geometry/tessellate.js";
import { filletedCube } from "./helpers/solidFixtures.js";

beforeAll(initKernel, 120000);

const viewportTriangles = (
  body: ReturnType<typeof filletedCube>,
  opts?: TessellationOptions,
) =>
  tessellateBody(body, { name: "b", visible: true }, opts).indices.length / 3;

it("meshes a 1 m filleted block at least 3 times coarser than 0.08 mm", () => {
  const scaled = viewportTriangles(filletedCube(1000, 50));
  const fixed = viewportTriangles(filletedCube(1000, 50), { linear: 0.08 });
  expect(scaled * 3).toBeLessThanOrEqual(fixed);
});

it("meshes a 5 mm filleted part no coarser than 0.08 mm", () => {
  const scaled = viewportTriangles(filletedCube(5, 1));
  const fixed = viewportTriangles(filletedCube(5, 1), { linear: 0.08 });
  expect(scaled).toBeGreaterThanOrEqual(fixed);
});

it("exports a viewport-meshed 5 mm filleted part at the chosen quality", () => {
  const body = filletedCube(5, 1);
  const viewport = viewportTriangles(body);
  expect(exportMesh(body).indices.length / 3).toBe(1380);
  expect(viewportTriangles(body)).toBe(viewport);
});
