import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type MeshedBody } from "@rockett/shared";
import { pickLabel } from "../components/form/fields";
import {
  fromRef,
  highlightSelection,
  refsOf,
  registerSelectionKind,
  selectionKey,
  selectionKinds,
  toRef,
  type Selection,
} from "./kinds";
import { HighlightContext } from "./highlights";
import { clearGroup } from "../three/dispose";
import { HIGHLIGHT_APPEARANCE } from "../tunables";
import { themeColor } from "../theme/tokens";
import {
  bodyIds,
  bodyPicks,
  edgeRefs,
  edgePicks,
  faceRefs,
  facePicks,
  profileRefs,
  profilePicks,
  selectedPlane,
} from "../features/inputs";

const cases = [
  [{ kind: "body", bodyId: "b" }, "body:b", "b"],
  [
    { kind: "face", bodyId: "b", faceName: "f" },
    "face:b:f",
    { kind: "face", bodyId: "b", faceName: "f" },
  ],
  [
    { kind: "edge", bodyId: "b", edgeName: "e" },
    "edge:b:e",
    { kind: "edge", bodyId: "b", edgeName: "e" },
  ],
  [
    { kind: "vertex", bodyId: "b", vertexName: "v" },
    "vertex:b:v",
    { kind: "vertex", bodyId: "b", vertexName: "v" },
  ],
  [
    { kind: "plane", ref: { kind: "origin", plane: "XY" }, label: "XY Plane" },
    'plane:{"kind":"origin","plane":"XY"}',
    { kind: "origin", plane: "XY" },
  ],
  [{ kind: "axis", axis: "Z" }, "axis:Z", { kind: "originAxis", axis: "Z" }],
  [
    { kind: "profile", sketchId: "s", profileId: "p" },
    "profile:s:p",
    { sketchId: "s", profileId: "p" },
  ],
  [{ kind: "sketch", sketchId: "s" }, "sketch:s", "s"],
  [
    { kind: "sketchEntity", sketchId: "s", entityId: "e", piece: [0, 1] },
    "se:s:e",
    { sketchId: "s", entityId: "e", piece: [0, 1] },
  ],
  [
    { kind: "sketchPoint", sketchId: "s", entityId: "p" },
    "sp:s:p",
    { kind: "sketchPoint", sketchId: "s", entityId: "p" },
  ],
] satisfies [Selection, string, unknown][];

describe("selection kinds", () => {
  it.each(cases)(
    "preserves the key and reference round trip for %j",
    (selection, key, ref) => {
      expect(selectionKey(selection)).toBe(key);
      expect(toRef(selection)).toEqual(ref);
      const restored = selectionKinds()
        .find((entry) => entry.kind === selection.kind)!
        .fromRef(ref);
      expect(selectionKey(restored)).toBe(key);
      expect(toRef(restored)).toEqual(ref);
    },
  );

  it("registers, filters, round trips and disposes a namespaced kind", () => {
    const node: Selection = { kind: "test.node", nodeId: "n" };
    const dispose = registerSelectionKind({
      kind: "test.node",
      highlight: () => {},
      key: (s) => `test.node:${s.nodeId}`,
      toRef: (s) => ({ nodeId: s.nodeId }),
      fromRef: (ref: unknown) => ({
        kind: "test.node",
        nodeId: (ref as { nodeId: string }).nodeId,
      }),
    });
    try {
      expect(selectionKey(node)).toBe("test.node:n");
      expect(pickLabel(node, null, null, [])).toBe("test.node:n");
      expect(
        pickLabel({ ...node, bodyId: "b", sketchId: "s" }, null, null, []),
      ).toBe("test.node:n");
      expect(refsOf([cases[0]![0], node], "test.node")).toEqual([
        { nodeId: "n" },
      ]);
      expect(fromRef("test.node", toRef(node))).toEqual(node);
      expect(() =>
        registerSelectionKind({
          kind: "test.node",
          highlight: () => {},
          key: () => "duplicate",
          toRef: () => null,
          fromRef: () => node,
        }),
      ).toThrow("selection kind registry already has test.node");
    } finally {
      dispose();
    }
    dispose();
    expect(() => selectionKey(node)).toThrow(
      "Unregistered selection kind: test.node",
    );
    expect(() => pickLabel(node, null, null, [])).toThrow(
      "Unregistered selection kind: test.node",
    );
    expect(() => toRef(node)).toThrow("Unregistered selection kind: test.node");
    expect(() => fromRef("test.node", {})).toThrow(
      "Unregistered selection kind: test.node",
    );
    expect(() => refsOf([node], "test.node")).toThrow(
      "Unregistered selection kind: test.node",
    );
  });

  it("rejects unnamespaced extension registrations", () => {
    expect(() =>
      registerSelectionKind({
        kind: "bad" as "test.bad",
        highlight: () => {},
        key: () => "bad",
        toRef: () => null,
        fromRef: () => ({ kind: "test.bad" }),
      }),
    ).toThrow("Invalid selection kind: bad");
  });

  it("keeps feature filters and plane priority", () => {
    const selection = cases.map(([s]) => s);
    expect(bodyIds(selection)).toEqual(["b"]);
    expect(edgeRefs(selection)).toEqual([cases[2]![2]]);
    expect(faceRefs(selection)).toEqual([cases[1]![2]]);
    expect(profileRefs(selection)).toEqual([cases[6]![2]]);
    expect(bodyPicks(bodyIds(selection))).toEqual([cases[0]![0]]);
    expect(edgePicks(edgeRefs(selection))).toEqual([cases[2]![0]]);
    expect(facePicks(faceRefs(selection))).toEqual([cases[1]![0]]);
    expect(profilePicks(profileRefs(selection))).toEqual([cases[6]![0]]);
    expect(selectedPlane(selection)).toEqual(cases[4]![2]);
    expect(selectedPlane([cases[1]![0]])).toEqual({
      kind: "face",
      face: cases[1]![2],
    });
    expect(selectedPlane([])).toBeNull();
  });

  it("retains core labels when their owners are absent", () => {
    expect(
      cases.map(([selection]) => pickLabel(selection, null, null, [])),
    ).toEqual([
      "Body",
      "Face",
      "Edge",
      "Vertex",
      "XY Plane",
      "Z Axis",
      "Profile",
      "Sketch",
      "Entity",
      "Entity",
    ]);
  });

  it("numbers topology within the selected body and retains missing-name labels", () => {
    const body: MeshedBody = {
      bodyId: "b",
      name: "Bracket",
      meshKey: "mesh",
      positions: [],
      normals: [],
      indices: [],
      faces: ["f1", "f2"].map((name) => ({
        name,
        start: 0,
        count: 0,
        surface: { type: "other" },
        area: 0,
      })),
      edges: ["e1", "e2"].map((name) => ({
        name,
        polyline: [],
        length: 0,
        curve: { type: "other" },
      })),
      vertices: ["v1", "v2"].map((name) => ({ name, position: [0, 0, 0] })),
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    };
    const label = (selection: Selection) =>
      pickLabel(selection, null, null, [body]);
    expect(label({ kind: "body", bodyId: "b" })).toBe("Bracket");
    expect(label({ kind: "face", bodyId: "b", faceName: "f2" })).toBe(
      "Face 2, Bracket",
    );
    expect(label({ kind: "edge", bodyId: "b", edgeName: "e2" })).toBe(
      "Edge 2, Bracket",
    );
    expect(label({ kind: "vertex", bodyId: "b", vertexName: "v2" })).toBe(
      "Vertex 2, Bracket",
    );
    expect(label({ kind: "face", bodyId: "b", faceName: "missing" })).toBe(
      "Face, Bracket",
    );
    expect(
      label({
        kind: "plane",
        ref: {
          kind: "face",
          face: { kind: "face", bodyId: "b", faceName: "f2" },
        },
        label: "Face plane",
      }),
    ).toBe("Face 2, Bracket");
  });

  it("numbers sketch entities by their kind and resolves construction owners", () => {
    const document = createEmptyDocument("test", "Test");
    document.features = [
      {
        id: "s",
        name: "Sketch A",
        suppressed: false,
        type: "sketch",
        plane: { kind: "origin", plane: "XY" },
        constraints: [],
        entities: [
          { kind: "point", id: "p1", x: 0, y: 0 },
          { kind: "line", id: "l1", p1: "p1", p2: "p2" },
          { kind: "point", id: "p2", x: 1, y: 0 },
          { kind: "line", id: "l2", p1: "p2", p2: "p1" },
        ],
      },
      {
        id: "plane",
        name: "Offset A",
        suppressed: false,
        type: "constructionPlane",
        method: {
          kind: "offset",
          base: { kind: "origin", plane: "XY" },
          distance: 1,
        },
      },
    ];
    const label = (selection: Selection) =>
      pickLabel(selection, document, null, []);
    expect(label({ kind: "sketch", sketchId: "s" })).toBe("Sketch A");
    expect(label({ kind: "sketchEntity", sketchId: "s", entityId: "l2" })).toBe(
      "Line 2, Sketch A",
    );
    expect(label({ kind: "sketchPoint", sketchId: "s", entityId: "p2" })).toBe(
      "Point 2, Sketch A",
    );
    expect(
      label({ kind: "sketchEntity", sketchId: "s", entityId: "missing" }),
    ).toBe("Entity, Sketch A");
    expect(
      label({
        kind: "plane",
        ref: { kind: "construction", featureId: "plane" },
        label: "Ignored",
      }),
    ).toBe("Offset A");
    expect(
      label({
        kind: "plane",
        ref: { kind: "construction", featureId: "missing" },
        label: "Ignored",
      }),
    ).toBe("Plane");
  });

  it.each([
    { kind: "construction", featureId: "p" },
    { kind: "face", face: { kind: "face", bodyId: "b", faceName: "f" } },
  ] as const)(
    "round trips plane references %j without persisting display labels",
    (ref) => {
      const selection: Selection = {
        kind: "plane",
        ref,
        label: "Custom plane",
      };
      expect(toRef(selection)).toEqual(ref);
      expect(selectionKey(fromRef("plane", ref))).toBe(selectionKey(selection));
    },
  );
});

function highlightFixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const payload: MeshedBody = {
    bodyId: "b",
    name: "Body",
    meshKey: "fixture",
    positions: Array.from(geometry.getAttribute("position").array),
    normals: Array.from(geometry.getAttribute("normal").array),
    indices: [0, 1, 2],
    faces: [
      { name: "f", start: 0, count: 3, surface: { type: "other" }, area: 0.5 },
    ],
    edges: [
      {
        name: "e",
        polyline: [0, 0, 0, 1, 0, 0],
        length: 1,
        curve: { type: "other" },
      },
    ],
    vertices: [{ name: "v", position: [1, 0, 0] }],
    bbox: { min: [0, 0, 0], max: [1, 1, 0] },
  };
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial(),
  );
  plane.userData.originPlane = "XY";
  const construction = plane.clone();
  construction.userData = { constructionPlane: "offset" };
  construction.position.set(1, 2, 3);
  construction.rotation.x = Math.PI / 2;
  const constructionPlanes = new THREE.Group();
  constructionPlanes.position.z = 4;
  constructionPlanes.add(construction);
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, 1),
    ]),
  );
  const ctx = new HighlightContext(root, {
    bodies: new Map([["b", { mesh, shape: payload }]]),
    originPlaneMeshes: [plane],
    originAxisLines: new Map([["Z", axis]]),
    constructionPlanes,
  });
  return { root, ctx, mesh, plane, construction };
}

describe("registered highlights", () => {
  it.each(["select", "hover"] as const)(
    "renders every core kind with existing %s appearance",
    (style) => {
      for (const [selection] of cases) {
        const { root, ctx, mesh } = highlightFixture();
        highlightSelection(selection, style, ctx);
        ctx.flush();
        const rendered = [
          "body",
          "face",
          "edge",
          "vertex",
          "plane",
          "axis",
        ].includes(selection.kind);
        expect(root.children).toHaveLength(rendered ? 1 : 0);
        if (!rendered) continue;
        const object = root.children[0]! as THREE.Mesh;
        const material = object.material as THREE.MeshBasicMaterial;
        expect(object.userData.themeToken).toBe(
          style === "select" ? "selection" : "hover",
        );
        expect(material.color.getHex()).toBe(
          new THREE.Color(themeColor(object.userData.themeToken)).getHex(),
        );
        if (selection.kind === "body" || selection.kind === "face") {
          expect(object.geometry.getAttribute("position")).toBe(
            mesh.geometry.getAttribute("position"),
          );
          expect(object.geometry.index!.array).toEqual(
            new Uint16Array([0, 1, 2]),
          );
          expect(material.opacity).toBe(
            HIGHLIGHT_APPEARANCE.faceOpacity[style],
          );
          expect(object.renderOrder).toBe(5);
        } else if (selection.kind === "edge" || selection.kind === "axis") {
          expect(object).toBeInstanceOf(THREE.Line);
          expect(object.geometry.getAttribute("position").count).toBe(2);
          expect(material.depthTest).toBe(false);
          expect(object.renderOrder).toBe(10);
        } else if (selection.kind === "vertex") {
          expect(object).toBeInstanceOf(THREE.Points);
          expect(
            Array.from(object.geometry.getAttribute("position").array),
          ).toEqual([1, 0, 0]);
          expect(object.renderOrder).toBe(11);
        } else {
          expect(material.opacity).toBe(
            HIGHLIGHT_APPEARANCE.originPlaneOpacity,
          );
          expect(material.side).toBe(THREE.DoubleSide);
          expect(material.depthWrite).toBe(false);
        }
        clearGroup(root);
        expect(mesh.geometry.getAttribute("position").count).toBe(3);
      }
    },
  );

  it("clones construction planes with their world transform and retains source resources", () => {
    const { root, ctx, construction } = highlightFixture();
    highlightSelection(
      {
        kind: "plane",
        ref: { kind: "construction", featureId: "offset" },
        label: "Plane",
      },
      "select",
      ctx,
    );
    ctx.flush();
    expect(root.children).toHaveLength(1);
    const clone = root.children[0]! as THREE.Mesh;
    expect(clone.geometry).not.toBe(construction.geometry);
    expect(clone.matrix).toEqual(construction.matrixWorld);
    const disposed: string[] = [];
    construction.geometry.addEventListener("dispose", () =>
      disposed.push("source geometry"),
    );
    construction.material.addEventListener("dispose", () =>
      disposed.push("source material"),
    );
    clone.geometry.addEventListener("dispose", () =>
      disposed.push("highlight geometry"),
    );
    (clone.material as THREE.Material).addEventListener("dispose", () =>
      disposed.push("highlight material"),
    );
    clearGroup(root);
    expect(disposed).toEqual(["highlight geometry", "highlight material"]);
    expect(construction.parent).toBeTruthy();
  });

  it("uses registered extension highlights and refuses them after disposal", () => {
    const node: Selection = { kind: "test.highlight", nodeId: "n" };
    const { root, ctx } = highlightFixture();
    const dispose = registerSelectionKind({
      kind: "test.highlight",
      key: () => "n",
      toRef: () => "n",
      fromRef: () => node,
      highlight: (selection, style, context) => {
        expect(selection.nodeId).toBe("n");
        context.point([2, 3, 4], style);
      },
    });
    try {
      highlightSelection(node, "hover", ctx);
      expect(root.children).toHaveLength(1);
      expect(
        Array.from(
          (root.children[0]! as THREE.Points).geometry.getAttribute("position")
            .array,
        ),
      ).toEqual([2, 3, 4]);
    } finally {
      dispose();
    }
    expect(() => highlightSelection(node, "hover", ctx)).toThrow(
      "Unregistered selection kind: test.highlight",
    );
    clearGroup(root);
  });

  it("keeps absent geometry, face planes and sketch-renderer selections empty", () => {
    const { root, ctx } = highlightFixture();
    for (const selection of [
      { kind: "body", bodyId: "missing" },
      { kind: "face", bodyId: "b", faceName: "missing" },
      { kind: "edge", bodyId: "b", edgeName: "missing" },
      { kind: "vertex", bodyId: "b", vertexName: "missing" },
      {
        kind: "plane",
        ref: { kind: "construction", featureId: "missing" },
        label: "Plane",
      },
      {
        kind: "plane",
        ref: {
          kind: "face",
          face: { kind: "face", bodyId: "b", faceName: "f" },
        },
        label: "Face",
      },
    ] satisfies Selection[])
      highlightSelection(selection, "select", ctx);
    ctx.flush();
    expect(root.children).toEqual([]);
  });
});
