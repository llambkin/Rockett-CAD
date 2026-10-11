import {
  base,
  face,
  prof,
  prof2,
  lineDocument,
  firstShell,
} from "./featureUi.fixtures";
import { featureParams } from "../commands/featureCommand";
import "../commands/design";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { renderToString } from "react-dom/server";
import {
  featureSpecs,
  type ExtensionFeature,
  type Feature,
  type SketchFeature,
} from "@rockett/shared";
import {
  featureUI,
  registerFeatureUI,
  type SharedInputParams,
  type FeatureUI,
  type InputParams,
} from "../features/registry";
import { useStore, type Selection } from "../store";

import { openFeatureEditor } from "../components/Timeline";
import "../features/core";
import { pickProviderIds, type PickInput } from "../commands/featureCommand";

it.each([
  ["offsetFace", [], "Select faces"],
  [
    "combine",
    [{ kind: "body", bodyId: "b1" }],
    "Select a target body then tool bodies",
  ],
  ["splitBody", [], "Select a body to split"],
  ["splitBody", [{ kind: "body", bodyId: "b1" }], "Select a splitting plane"],
  ["mirror", [], "Select bodies to mirror"],
  ["mirror", [{ kind: "body", bodyId: "b1" }], "Select a mirror plane"],
  ["linearPattern", [], "Select bodies to pattern"],
  ["circularPattern", [], "Select bodies to pattern"],
  ["revolve", [], "Select at least one profile or planar face"],
] as const)("%s refuses an incomplete selection", (type, selection, error) => {
  expect(
    featureUI(type)!
      .create()
      .withParams({})
      .build([...selection]),
  ).toEqual({ error });
});

it.each([
  ["linearPattern", "Pick a direction"],
  ["circularPattern", "Pick an axis"],
  ["revolve", "Pick an axis"],
] as const)("%s refuses an edge axis with no edge picked", (type, error) => {
  const selection: Selection[] = [
    { kind: "body", bodyId: "b1" },
    { kind: "profile", ...prof },
  ];
  expect(
    featureUI(type)!
      .create()
      .withParams({ axisSource: "edge" })
      .build(selection),
  ).toEqual({
    error,
  });
});

it.each([
  ["linearPattern", "Direction", "X", "Selected edge", "X"],
  ["circularPattern", "Axis", "Z", "Selected line/edge", "Z"],
  ["revolve", "Axis", "Z", "Selected line/edge", "Z"],
] as const)(
  "the %s axis list defaults and labels as before",
  (type, label, selected, edgeOption, defaultAxis) => {
    const inputs = featureUI(type)!.create();
    const html = renderToString(inputs.renderForm(() => {}));
    expect(html).toContain(`<span>${label}</span><select>`);
    expect(html).toContain(`<option value="${selected}" selected="">`);
    expect(html).toContain(`<option value="edge">${edgeOption}</option>`);
    const built = inputs.build([
      { kind: "body", bodyId: "b1" },
      { kind: "profile", ...prof },
    ]);
    if (
      !built ||
      "error" in built ||
      !("axis" in built || built.type === "linearPattern")
    )
      throw new Error("Expected axis feature");
    expect(
      built.type === "linearPattern" && built.direction.kind === "axis"
        ? built.direction.axis
        : "axis" in built &&
            typeof built.axis === "object" &&
            built.axis.kind === "originAxis"
          ? built.axis.axis
          : undefined,
    ).toBe(defaultAxis);
  },
);

it("the importStep UI replaces the generic panel", () => {
  const ui = featureUI("importStep")!;
  expect(ui.hasPanel).toBe(true);
  expect(ui.hasBuild).toBe(false);
});

it("registerFeatureUI returns a disposer", () => {
  const shell = {
    type: "shell",
    icon: "shell",
    title: "Shell",
    group: "test",
    picks: [],
    open: async (_f: Feature) => {},
  } satisfies FeatureUI<Feature, InputParams<Record<never, never>>>;
  expect(() => registerFeatureUI(shell)).toThrow(/shell/);
  const dispose = registerFeatureUI({ ...shell, type: "test.block" });
  expect(featureUI("test.block")).toBeDefined();
  dispose();
  expect(featureUI("test.block")).toBeUndefined();
});

it("startup registers a feature UI for every core feature type", () => {
  const types = featureSpecs.list().map((spec) => spec.type);
  expect(types).toEqual(
    expect.arrayContaining(["extrude", "sketch", "importMesh"]),
  );
  expect(
    types.filter((type) => !featureUI(type)?.open && !featureUI(type)?.prefill),
  ).toEqual([]);
});

describe("featureUI(type).open", () => {
  beforeEach(() => {
    useStore.setState({
      active: null,
      selection: [],
    });
  });

  it("prefills the feature's dialog by default", async () => {
    const f = firstShell;
    await openFeatureEditor(f);
    const s = useStore.getState();
    expect(s.active).toEqual({
      id: "design.feature",
      state: {
        type: "shell",
        selectionBefore: [],
        editFeatureId: "sh1",
        inputs: expect.any(Object),
      },
    });
    expect(featureParams(s)).toEqual({
      id: "sh1",
      name: "Shell1",
      shellDirection: "inside",
      thickness: 1.5,
    });
    expect(s.selection).toEqual([face("b1", "f1")]);
  });

  it("opens an imported mesh in the import panel", async () => {
    const mesh: Feature = {
      ...base,
      id: "im",
      type: "importMesh",
      name: "Mesh1",
      filename: "part.stl",
      format: "stl",
      blob: "0".repeat(64),
    };
    await openFeatureEditor(mesh);
    expect(useStore.getState().active).toEqual({
      id: "design.feature",
      state: {
        type: "importMesh",
        selectionBefore: [],
        editFeatureId: "im",
        inputs: expect.any(Object),
      },
    });
    const panelProps = {
      onClose: () => {},
      cancelPreview: () => {},
      update: async () => {},
    };
    const meshPanel = featureUI("importMesh")!
      .create()
      .renderPanel(panelProps, () => {});
    const stepPanel = featureUI("importStep")!
      .create()
      .renderPanel(panelProps, () => {});
    if (!isValidElement(meshPanel) || !isValidElement(stepPanel))
      throw new Error("Expected import panels");
    expect(meshPanel.type).toBe(stepPanel.type);
  });

  it("enters sketch editing for a sketch", async () => {
    const editSketch = vi.fn(async () => {});
    useStore.setState({ editSketch });
    const sketch: SketchFeature = {
      ...base,
      id: "sk1",
      type: "sketch",
      plane: { kind: "origin", plane: "XY" },
      entities: [],
      constraints: [],
    };
    await openFeatureEditor(sketch);
    expect(editSketch).toHaveBeenCalledWith("sk1");
    expect(useStore.getState().active).toBeNull();
  });

  it("reopens a test.block through its registered UI and skips an unregistered one", async () => {
    const block: ExtensionFeature = {
      ...base,
      id: "blk",
      type: "test.block",
      name: "Block1",
      version: 2,
      params: { width: 1, depth: 2, height: 3 },
    };
    const open = vi.fn(async (_f: ExtensionFeature) => {});
    const dispose = registerFeatureUI({
      type: "test.block",
      icon: "block",
      title: "Block",
      group: "test",
      picks: [],
      open,
    });
    try {
      await openFeatureEditor(block);
      expect(open).toHaveBeenCalledWith(block);
    } finally {
      dispose();
    }
    await expect(openFeatureEditor(block)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
    expect(useStore.getState().active).toBeNull();
  });
});

const extrudes: Feature[] = [
  {
    ...base,
    id: "ex1",
    type: "extrude",
    name: "Extrude1",
    profiles: [prof, prof2],
    distance: 12,
    direction: "normal",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex2",
    type: "extrude",
    profiles: [],
    faces: [face("b1", "f1")],
    distance: -4,
    direction: "normal",
    operation: "cut",
    targets: ["b1"],
  },
  {
    ...base,
    id: "ex3",
    type: "extrude",
    profiles: [prof],
    faces: [face("b1", "f2")],
    distance: 5,
    distance2: 3,
    startOffset: -1,
    direction: "twoSided",
    operation: "join",
    targets: ["b1", "b2"],
  },
  {
    ...base,
    id: "ex4",
    type: "extrude",
    profiles: [prof],
    faces: [],
    distance: 8,
    distance2: 2,
    startOffset: 0,
    direction: "symmetric",
    operation: "intersect",
  },
  {
    ...base,
    id: "ex5",
    type: "extrude",
    profiles: [prof],
    distance: 2,
    direction: "reverse",
    operation: "join",
  },
  {
    ...base,
    id: "ex6",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    extent: { kind: "all" },
    direction: "symmetric",
    operation: "cut",
  },
  {
    ...base,
    id: "ex7",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    extent: {
      kind: "toObject",
      object: { kind: "face", face: face("b1", "f3") },
    },
    direction: "normal",
    operation: "join",
  },
  {
    ...base,
    id: "ex8",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    extent: { kind: "toObject", object: { kind: "body", bodyId: "b2" } },
    direction: "normal",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex9",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    extent: {
      kind: "toObject",
      object: { kind: "origin", plane: "XZ" },
    },
    direction: "reverse",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex10",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    startObject: { kind: "construction", featureId: "cp1" },
    direction: "symmetric",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex11",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    startObject: { kind: "face", face: face("b1", "f3") },
    extent: { kind: "toObject", object: { kind: "origin", plane: "XY" } },
    direction: "normal",
    operation: "join",
  },
  {
    ...base,
    id: "ex12",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    taper: -5,
    direction: "normal",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex13",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    distance2: 4,
    extent: { kind: "all" },
    taper: 2.5,
    taper2: -3,
    direction: "twoSided",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex14",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    thin: { location: "outside", thickness: 1.5 },
    direction: "normal",
    operation: "newBody",
  },
  {
    ...base,
    id: "ex15",
    type: "extrude",
    profiles: [],
    curves: [{ kind: "sketchEntity", sketchId: "sk1", entityId: "ln1" }],
    distance: 10,
    distance2: 4,
    thin: { location: "centre", thickness: 2 },
    direction: "twoSided",
    operation: "newBody",
  },
];

it.each(extrudes.map((f) => [f.id, f] as const))(
  "extrude build(prefill(f)) round-trips %s while it is stored",
  (_id, f) => {
    const doc = lineDocument();
    doc.features.push(f);
    useStore.setState({ document: doc });
    const ui = featureUI("extrude")!;
    const { inputs, selection } = ui.prefill!(f);
    expect(inputs.build(selection)).toEqual(f);
  },
);

it.each([
  [[], {}, "Select at least one profile or planar face"],
  [
    [{ kind: "sketchEntity", sketchId: "sk1", entityId: "ln1" }],
    {},
    "Select at least one profile or planar face",
  ],
  [
    [{ kind: "profile", ...prof }],
    { distance: 0 },
    "Extrude distance must be non-zero",
  ],
  [
    [{ kind: "profile", ...prof }],
    { start: "object" },
    "Select a plane or planar face to start on",
  ],
] as const)("extrude refuses %j with %j", (selection, params, error) => {
  useStore.setState({ document: lineDocument() });
  expect(
    featureUI("extrude")!
      .create()
      .withParams({ ...params })
      .build([...selection]),
  ).toEqual({
    error,
  });
});

const change = (params: SharedInputParams) =>
  featureUI("extrude")!.create().withParams(params).onParamsChange();

describe("extrude auto-cut", () => {
  const top: Selection = { kind: "face", bodyId: "b1", faceName: "top" };
  const plane = { type: "plane", origin: [0, 0, 10], normal: [0, 0, 1] };
  beforeEach(() => {
    useStore.setState({
      document: lineDocument(),
      active: {
        id: "design.feature",
        state: {
          type: "extrude",
          selectionBefore: [],
          inputs: featureUI("extrude")!.create().withParams({}),
        },
      },
      selection: [top],
      evaluation: {
        bodies: [
          {
            bodyId: "b1",
            name: "Body1",
            meshKey: "b1",
            positions: [0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10],
            normals: [],
            indices: [0, 1, 2, 0, 2, 3],
            faces: [
              { name: "top", start: 0, count: 6, area: 100, surface: plane },
            ],
            edges: [],
            vertices: [],
            bbox: { min: [0, 0, 0], max: [10, 10, 10] },
          },
        ],
        planes: [],
        sketches: [],
        featureStatuses: [],
        kernelMs: 0,
      } as never,
    });
  });

  it("sets cut for a negative distance into the body", () => {
    expect(change({ distance: -5 })).toEqual({
      operation: "cut",
      autoOperation: true,
    });
  });

  it("restores join for a positive distance only when the cut was auto-set", () => {
    const cut: SharedInputParams = { distance: 5, operation: "cut" };
    expect(change({ ...cut, autoOperation: true })).toEqual({
      operation: "join",
      autoOperation: true,
    });
    expect(change({ ...cut, autoOperation: false })).toBeUndefined();
  });

  it("leaves a zero distance and an unchanged operation alone and never writes", () => {
    expect(change({ distance: 0 })).toBeUndefined();
    expect(
      change({ distance: -5, operation: "cut", autoOperation: true }),
    ).toBeUndefined();
    expect(featureParams(useStore.getState())).toEqual({});
  });
});

it("Shift picks faces through the pick data, not the kinds", () => {
  const [profiles] = featureUI("extrude")!.picks;
  expect(profiles).toMatchObject({ key: "profiles", shiftFaces: true });
  const plain: PickInput = {
    key: "p",
    providers: ["design.face", "sketch.profile"],
  };
  expect(pickProviderIds(plain, true)).toEqual([
    "design.face",
    "sketch.profile",
  ]);
  expect(pickProviderIds(profiles, true)).toEqual(["design.face"]);
  expect(pickProviderIds(profiles, false)).toEqual(["sketch.profile"]);
});

it("keeps point-only pick inputs considering curves", () => {
  const points: PickInput = { key: "point", providers: ["sketch.point"] };
  expect(pickProviderIds(points)).toEqual(["sketch.entity", "sketch.point"]);
});
