import { describe, expect, it } from "vitest";
import { createEmptyDocument, type BodyPayload } from "@rockett/shared";
import { pickLabel } from "../components/form/fields";
import {
  fromRef,
  refsOf,
  registerSelectionKind,
  selectionKey,
  selectionKinds,
  toRef,
  type Selection,
} from "./kinds";
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
    const body: BodyPayload = {
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
