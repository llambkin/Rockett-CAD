import { sketchBuilder } from "../../shared/src/sketchBuilder.js";
import { beforeAll, expect, it } from "vitest";
import {
  createEmptyDocument,
  type FaceRef,
  type LoftFeature,
} from "@rockett/shared";
import { emptyState, evaluateFeature } from "../src/geometry/features.js";
import {
  bboxOf,
  faceCentroid,
  faces,
  getKernel,
  initKernel,
  planarFacePlane,
  pnt,
  progress,
  volumeOf,
} from "../src/geometry/kernel.js";
import { finalizeNames } from "../src/geometry/naming.js";
import { ShapeMap } from "../src/geometry/shapeMap.js";
import { validateFeature, validateDocument } from "../src/api/validate.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { MemoryStorage } from "./helpers/memoryStorage.js";

beforeAll(initKernel, 120_000);

function fixture() {
  const k = getKernel(),
    state = emptyState();
  const sections: FaceRef[] = [];
  for (const [id, z, cap] of [
    ["lower", 0, 10],
    ["upper", 30, 30],
  ] as const) {
    const point = pnt(0, 0, z);
    const maker = new k.BRepPrimAPI_MakeBox_3(point, 10, 10, 10);
    const shape = maker.Shape();
    const names = finalizeNames(shape, new ShapeMap(), id);
    state.bodies.set(id, { bodyId: id, shape, names });
    const face = faces(shape).find(
      (f) => Math.abs(faceCentroid(f)[2] - cap) < 1e-6,
    )!;
    sections.push({ kind: "face", bodyId: id, faceName: names.get(face)! });
    maker.delete();
    point.delete();
  }
  const loft: LoftFeature = {
    id: "loft",
    name: "Loft",
    type: "loft",
    suppressed: false,
    sections,
    operation: "newBody",
  };
  return { state, loft, doc: createEmptyDocument("face-loft", "Face loft") };
}

it("accepts planar face sections and builds the exact bridge volume", () => {
  const { state, loft, doc } = fixture();
  expect(() => validateFeature(loft)).not.toThrow();
  evaluateFeature(state, loft, doc.features);
  expect(volumeOf(state.bodies.get("b:loft")!.shape)).toBeCloseTo(2000, 5);
  expect(state.bodies.size).toBe(3);
});

it("joins both selected bodies into one solid", () => {
  const { state, loft, doc } = fixture();
  evaluateFeature(state, { ...loft, operation: "join" }, doc.features);
  expect(state.bodies.size).toBe(1);
  expect(volumeOf([...state.bodies.values()][0]!.shape)).toBeCloseTo(4000, 5);
});

it("reports a missing face instead of switching to another section", () => {
  const { state, loft, doc } = fixture();
  (loft.sections[0] as FaceRef).faceName = "missing";
  expect(() => evaluateFeature(state, loft, doc.features)).toThrow(
    /face.*missing.*no longer exists/,
  );
});

it("bends smoothly through an offset sketch between two face sections", () => {
  const { state, loft, doc } = fixture();
  evaluateFeature(
    state,
    {
      id: "plane",
      name: "Plane",
      type: "constructionPlane",
      suppressed: false,
      method: {
        kind: "offset",
        base: { kind: "origin", plane: "XY" },
        distance: 20,
      },
    },
    doc.features,
  );
  const builder = sketchBuilder();
  builder.line([12, 0], [22, 0]);
  builder.line([22, 0], [22, 10]);
  builder.line([22, 10], [12, 10]);
  builder.line([12, 10], [12, 0]);
  evaluateFeature(
    state,
    {
      id: "middle",
      name: "Middle",
      type: "sketch",
      suppressed: false,
      plane: { kind: "construction", featureId: "plane" },
      entities: builder.entities,
      constraints: [],
    },
    doc.features,
  );
  loft.sections.splice(1, 0, {
    sketchId: "middle",
    profileId: state.sketches.get("middle")!.profiles[0]!.id,
  });
  evaluateFeature(state, loft, doc.features);
  const shape = state.bodies.get("b:loft")!.shape;
  expect(bboxOf(shape).max[0]).toBeGreaterThan(21.9);
  expect(faces(shape).some((face) => !planarFacePlane(face))).toBe(true);
  const check = new (getKernel().BRepCheck_Analyzer)(shape, true, false);
  expect(check.IsValid_2()).toBe(true);
  check.delete();
  expect(volumeOf(state.bodies.get("lower")!.shape)).toBeCloseTo(1000, 5);
});

it.each(["curved", "hole"])(
  "rejects a %s face with an actionable error",
  (kind) => {
    const { state, loft, doc } = fixture();
    const k = getKernel(),
      outer = new k.BRepPrimAPI_MakeCylinder_1(8, 10);
    let shape = outer.Shape();
    if (kind === "hole") {
      const inner = new k.BRepPrimAPI_MakeCylinder_1(3, 10);
      const cut = new k.BRepAlgoAPI_Cut_3(shape, inner.Shape(), progress());
      cut.Build(progress());
      shape = cut.Shape();
      cut.delete();
      inner.delete();
    }
    const names = finalizeNames(shape, new ShapeMap(), "cylinder");
    state.bodies.set("cylinder", { bodyId: "cylinder", shape, names });
    const face = faces(shape).find((f) =>
      kind === "curved"
        ? !planarFacePlane(f)
        : Math.abs(faceCentroid(f)[2] - 10) < 1e-6,
    )!;
    loft.sections[0] = {
      kind: "face",
      bodyId: "cylinder",
      faceName: names.get(face)!,
    };
    expect(() => evaluateFeature(state, loft, doc.features)).toThrow(
      kind === "curved" ? /must be planar/ : /faces with holes/,
    );
    outer.delete();
  },
);

it("backs up schema 11 before saving face loft sections", async () => {
  const { loft, doc } = fixture();
  const storage = new MemoryStorage();
  const legacyLoft: LoftFeature = {
    ...loft,
    sections: [
      { sketchId: "first", profileId: "region1" },
      { sketchId: "second", profileId: "region2" },
    ],
  };
  const legacy = {
    ...doc,
    schemaVersion: 11,
    features: [legacyLoft],
    timelinePosition: 1,
  };
  const raw = JSON.stringify(legacy);
  await storage.writeAtomic(`projects/${doc.id}/document.json`, raw);
  const store = new ProjectStore(storage, validateDocument);
  const loaded = await store.load(doc.id);
  expect(loaded.schemaVersion).toBe(12);
  expect(loaded.features).toEqual([legacyLoft]);
  loaded.features = [loft];
  loaded.timelinePosition = 1;
  await store.save(loaded);
  expect((await store.load(doc.id)).features).toEqual([loft]);
  const backup = [...storage.data.entries()].find(([key]) =>
    key.includes("/files/document.json"),
  );
  expect(backup?.[1].toString()).toBe(raw);
});
