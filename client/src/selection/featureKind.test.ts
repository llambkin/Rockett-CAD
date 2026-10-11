import * as THREE from "three";
import { expect, it } from "vitest";
import { createEmptyDocument, type MeshedBody } from "@rockett/shared";
import { pickLabel } from "../components/form/fields";
import {
  fromRef,
  highlightSelection,
  refsOf,
  selectionKey,
  toRef,
  type Selection,
} from "./kinds";
import { HighlightContext } from "./highlights";

const pick: Selection = { kind: "feature", featureId: "ex1" };

it("keys and round trips a feature pick through its id", () => {
  expect(selectionKey(pick)).toBe("feature:ex1");
  expect(toRef(pick)).toBe("ex1");
  expect(fromRef("feature", "ex1")).toEqual(pick);
  expect(refsOf([pick, { kind: "body", bodyId: "b" }], "feature")).toEqual([
    "ex1",
  ]);
});

it("labels a feature pick by the feature's name", () => {
  const doc = createEmptyDocument("d1", "Doc");
  doc.features = [
    {
      id: "ex1",
      type: "shell",
      name: "Shell1",
      suppressed: false,
      openFaces: [],
      direction: "inside",
      thickness: 1,
    },
  ];
  expect(pickLabel(pick, doc, null, [])).toBe("Shell1");
  expect(pickLabel({ ...pick, featureId: "gone" }, doc, null, [])).toBe(
    "Feature",
  );
});

const face = (name: string, start: number) => ({
  name,
  start,
  count: 3,
  surface: { type: "other" as const },
  area: 1,
});

const zeros = () =>
  new THREE.Float32BufferAttribute(
    Array.from({ length: 18 }, () => 0),
    3,
  );

function body(bodyId: string, faces: MeshedBody["faces"]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", zeros());
  geometry.setAttribute("normal", zeros());
  const payload = {
    bodyId,
    meshKey: bodyId,
    positions: Array.from({ length: 18 }, () => 0),
    normals: Array.from({ length: 18 }, () => 0),
    indices: [0, 1, 2, 3, 4, 5],
    faces,
    edges: [],
    vertices: [],
  } as unknown as MeshedBody;
  return [bodyId, { shape: payload, mesh: new THREE.Mesh(geometry) }] as const;
}

it("highlights every face the feature made on every body", () => {
  const root = new THREE.Group();
  const ctx = new HighlightContext(root, {
    bodies: new Map([
      body("b1", [face("f:ex1:top", 0), face("f:sk1:side", 3)]),
      body("b2", [face("p0:ex1:cap", 0)]),
      body("b3", [face("f:ex10:top", 0)]),
    ]),
    originPlaneMeshes: [],
    originAxisLines: new Map(),
    constructionPlanes: new THREE.Group(),
  });
  highlightSelection(pick, "select", ctx);
  ctx.flush();
  expect(
    root.children.map((child) =>
      Array.from((child as THREE.Mesh).geometry.index!.array),
    ),
  ).toEqual([
    [0, 1, 2],
    [0, 1, 2],
  ]);
});
