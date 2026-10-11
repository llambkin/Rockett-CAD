import { beforeAll, describe, expect, it } from "vitest";
import type { Placement } from "../src/shared/setup.js";
import { dropCutter, indexMesh, type Mesh } from "../src/surface/dropCutter.js";
import { read, shapes, toSetup } from "../src/kernel/regions.js";
import {
  CACHED_MESHES,
  CHORD_FRACTION,
  type SurfaceMeshInput,
} from "../src/kernel/surfaceMesh.js";
import {
  SAME,
  box,
  brep,
  moduleJob,
  oc,
  scoped,
  startKernel,
  type Own,
} from "./helpers/kernel.js";
import { tools } from "./helpers/meshes.js";

const ENTRY = new URL("../src/kernel/surfaceMesh.ts", import.meta.url).href;
const TURNED: Placement = {
  rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  translation: [40, 0, 0],
};

let block: string;

beforeAll(async () => {
  await startKernel();
  block = brep((own) => box(own, [0, 0, 0], [10, 10, 10]));
}, 120_000);

function filletedBlock(own: Own) {
  const solid = box(own, [0, 0, 0], [60, 40, 10]);
  const op = own(
    new oc.BRepFilletAPI_MakeFillet(
      solid,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    ),
  );
  for (const edge of shapes({ oc, own, progress() {} }, solid, "TopAbs_EDGE"))
    op.Add_2(3, own(oc.TopoDS.Edge_1(edge)));
  op.Build(own(new oc.Message_ProgressRange_1()));
  return own(op.Shape());
}

const surfaceMesh = (input: SurfaceMeshInput) =>
  moduleJob(ENTRY, "rockett.cam.surfaceMesh", input) as Promise<Mesh>;

function points(mesh: Mesh) {
  const at = (i: number) =>
    [0, 1, 2].map((k) => mesh.positions[3 * i + k]!) as [
      number,
      number,
      number,
    ];
  const vertices = Array.from({ length: mesh.positions.length / 3 }, (_, i) =>
    at(i),
  );
  const centroids = Array.from({ length: mesh.indices.length / 3 }, (_, t) => {
    const corners = [0, 1, 2].map((k) => at(mesh.indices[3 * t + k]!));
    return [0, 1, 2].map(
      (k) => (corners[0]![k]! + corners[1]![k]! + corners[2]![k]!) / 3,
    ) as [number, number, number];
  });
  return { vertices, centroids };
}

function farthest(text: string, frame: Placement, from: number[][]) {
  return scoped((own) => {
    const scope = { oc, own, progress() {} };
    const body = toSetup(scope, read(scope, text, "test"), frame);
    const [shell] = shapes(scope, body, "TopAbs_SHELL");
    let worst = 0;
    for (const [x, y, z] of from) {
      const vertex = own(
        own(
          new oc.BRepBuilderAPI_MakeVertex(own(new oc.gp_Pnt_3(x, y, z))),
        ).Vertex(),
      );
      const distance = own(
        new oc.BRepExtrema_DistShapeShape_2(
          vertex,
          shell,
          oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
          oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
          own(new oc.Message_ProgressRange_1()),
        ),
      );
      if (!distance.IsDone()) throw new Error("distance check failed");
      worst = Math.max(worst, distance.Value());
    }
    return worst;
  });
}

function bounds({ positions }: Mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, positions[i]!);
  }
  return { min, max };
}

describe("rockett.cam.surfaceMesh", () => {
  it("puts every vertex and triangle centroid of a filleted block within the chord tolerance of the body in the setup frame", async () => {
    const text = brep(filletedBlock);
    const tolerance = 0.1;
    const chord = tolerance * CHORD_FRACTION;
    const mesh = await surfaceMesh({
      bodies: [{ identity: "filleted", brep: text }],
      modelToSetup: TURNED,
      tolerance,
    });
    const { vertices, centroids } = points(mesh);
    expect(farthest(text, TURNED, vertices)).toBeLessThanOrEqual(chord);
    expect(farthest(text, TURNED, centroids)).toBeLessThanOrEqual(chord);
    const { min, max } = bounds(mesh);
    min.forEach((value, k) => expect(value).toBeCloseTo([0, 0, 0][k]!, 6));
    max.forEach((value, k) => expect(value).toBeCloseTo([40, 60, 10][k]!, 6));
  });

  it("joins every setup body into one mesh the drop cutter reads directly", async () => {
    const far = brep((own) => box(own, [20, 0, 0], [10, 10, 5]));
    const mesh = await surfaceMesh({
      bodies: [
        { identity: "near", brep: block },
        { identity: "far", brep: far },
      ],
      modelToSetup: SAME,
      tolerance: 0.01,
    });
    const count = mesh.positions.length / 3;
    expect(Array.from(mesh.indices).every((i) => i < count)).toBe(true);
    expect(new Set(Array.from(mesh.indices)).size).toBe(count);
    expect(bounds(mesh)).toEqual({ min: [0, 0, 0], max: [30, 10, 10] });
    const indexed = indexMesh(mesh);
    expect(dropCutter(indexed, tools[0]!, 5, 5)).toBeCloseTo(10, 9);
    expect(dropCutter(indexed, tools[0]!, 25, 5)).toBeCloseTo(5, 9);
  });

  it("reads a repeat call from the cache and misses on a changed identity, frame or tolerance", async () => {
    const input: SurfaceMeshInput = {
      bodies: [{ identity: "repeat", brep: block }],
      modelToSetup: SAME,
      tolerance: 0.01,
    };
    const first = await surfaceMesh(input);
    expect(await surfaceMesh(structuredClone(input))).toBe(first);
    for (const changed of [
      { ...input, bodies: [{ identity: "other", brep: block }] },
      { ...input, modelToSetup: TURNED },
      { ...input, tolerance: 0.02 },
    ]) {
      const missed = await surfaceMesh(changed);
      expect(missed).not.toBe(first);
      expect(missed.indices.length).toBeGreaterThan(0);
    }
  });

  it(`keeps the ${CACHED_MESHES} most recently used meshes`, async () => {
    const input = (identity: string): SurfaceMeshInput => ({
      bodies: [{ identity, brep: block }],
      modelToSetup: SAME,
      tolerance: 0.05,
    });
    const others = Array.from({ length: CACHED_MESHES }, (_, i) => `lru-${i}`);
    const kept = await surfaceMesh(input("lru-kept"));
    for (const identity of others.slice(1)) await surfaceMesh(input(identity));
    expect(await surfaceMesh(input("lru-kept"))).toBe(kept);
    for (const identity of others) await surfaceMesh(input(identity));
    expect(await surfaceMesh(input("lru-kept"))).not.toBe(kept);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a finishing tolerance of %s",
    async (tolerance) => {
      await expect(
        surfaceMesh({
          bodies: [{ identity: "bad", brep: block }],
          modelToSetup: SAME,
          tolerance,
        }),
      ).rejects.toThrow("surface mesh tolerance must be a number above 0");
    },
  );

  it("refuses input that is not a BREP body", async () => {
    await expect(
      surfaceMesh({
        bodies: [{ identity: "text", brep: "not a shape" }],
        modelToSetup: SAME,
        tolerance: 0.01,
      }),
    ).rejects.toThrow("surfaceMesh input is not a readable BREP body");
  });
});
