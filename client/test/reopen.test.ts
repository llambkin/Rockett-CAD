/**
 * Reopen contract: double-clicking a timeline chip (openFeatureEditor) must
 * prefill the dialog so that pressing OK rebuilds the same feature.
 *
 * FeatureDialog is rendered with react-dom/server (no DOM needed); a mocked
 * DraggablePanel captures the panel's children so the test can press OK.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  createEmptyDocument,
  type Feature,
  type SketchFeature,
} from "@rockett/shared";
import { useStore } from "../src/store";
import { filterSelectionFor } from "../src/dialogPicks";
import { openFeatureEditor } from "../src/components/Timeline";
import { FeatureDialog } from "../src/components/FeatureDialog";

vi.mock("../src/api", () => ({ api: {} }));
const panels: { children: ReactNode }[] = [];
vi.mock("../src/components/DraggablePanel", () => ({
  DraggablePanel: (props: { children: ReactNode }) => {
    panels.push(props);
    return null;
  },
}));

const sketch: SketchFeature = {
  id: "sk1",
  type: "sketch",
  name: "Sketch1",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [
    { id: "p1", kind: "point", x: 0, y: 0 },
    { id: "p2", kind: "point", x: 10, y: 0 },
    { id: "ln1", kind: "line", p1: "p1", p2: "p2" },
  ],
  constraints: [],
};
const base = { name: "F", suppressed: false };
const prof = { sketchId: "sk1", profileId: "pr1" };
const prof2 = { sketchId: "sk1", profileId: "pr2" };
const edge = { kind: "edge" as const, bodyId: "b1", edgeName: "e1" };
const face = { kind: "face" as const, bodyId: "b1", faceName: "f1" };
const xy = { kind: "origin" as const, plane: "XY" as const };
const yz = { kind: "origin" as const, plane: "YZ" as const };
const onFace = { kind: "face" as const, face };

/** Every editable type, with each reference variant the dialog can build. */
const cases: Feature[] = [
  {
    ...base,
    id: "ex",
    type: "extrude",
    profiles: [prof],
    faces: [face],
    distance: 12,
    distance2: 4,
    startOffset: 1,
    direction: "twoSided",
    operation: "cut",
  },
  {
    ...base,
    id: "rvO",
    type: "revolve",
    profiles: [prof],
    axis: { kind: "originAxis", axis: "Y" },
    angle: 90,
    operation: "newBody",
  },
  {
    ...base,
    id: "rvE",
    type: "revolve",
    profiles: [prof],
    axis: { kind: "edge", edge },
    angle: 180,
    operation: "join",
  },
  {
    ...base,
    id: "rvS",
    type: "revolve",
    profiles: [prof],
    axis: { kind: "sketchLine", sketchId: "sk1", entityId: "ln1" },
    angle: 360,
    operation: "join",
  },
  {
    ...base,
    id: "sw",
    type: "sweep",
    profiles: [prof],
    pathSketchId: "sk1",
    operation: "newBody",
  },
  {
    ...base,
    id: "lo",
    type: "loft",
    sections: [prof, prof2],
    operation: "join",
  },
  {
    ...base,
    id: "fi",
    type: "fillet",
    edges: [edge],
    radius: 3,
    tangentChain: true,
  },
  {
    ...base,
    id: "ch",
    type: "chamfer",
    edges: [edge],
    distance: 2,
    tangentChain: false,
  },
  { ...base, id: "sh", type: "shell", openFaces: [face], thickness: 1.5 },
  {
    ...base,
    id: "co",
    type: "combine",
    operation: "cut",
    targetBody: "b1",
    toolBodies: ["b2", "b3"],
    keepTools: true,
  },
  { ...base, id: "spP", type: "splitBody", body: "b1", tool: xy },
  { ...base, id: "spF", type: "splitBody", body: "b1", tool: onFace },
  { ...base, id: "of", type: "offsetFace", faces: [face], distance: -2 },
  {
    ...base,
    id: "mi",
    type: "mirror",
    bodies: ["b1"],
    plane: yz,
    combine: false,
  },
  {
    ...base,
    id: "lpA",
    type: "linearPattern",
    bodies: ["b1"],
    direction: { kind: "axis", axis: "Y" },
    count: 4,
    spacing: 15,
    combine: true,
  },
  {
    ...base,
    id: "lpE",
    type: "linearPattern",
    bodies: ["b1"],
    direction: { kind: "edge", edge },
    count: 2,
    spacing: 5,
    combine: false,
  },
  {
    ...base,
    id: "cpO",
    type: "circularPattern",
    bodies: ["b1"],
    axis: { kind: "originAxis", axis: "X" },
    count: 5,
    totalAngle: 180,
    combine: true,
  },
  {
    ...base,
    id: "cpE",
    type: "circularPattern",
    bodies: ["b1"],
    axis: { kind: "edge", edge },
    count: 6,
    totalAngle: 360,
    combine: false,
  },
  {
    ...base,
    id: "cpS",
    type: "circularPattern",
    bodies: ["b1"],
    axis: { kind: "sketchLine", sketchId: "sk1", entityId: "ln1" },
    count: 3,
    totalAngle: 120,
    combine: false,
  },
  {
    ...base,
    id: "cpOff",
    type: "constructionPlane",
    method: { kind: "offset", base: onFace, distance: 7 },
  },
  {
    ...base,
    id: "cpMid",
    type: "constructionPlane",
    method: { kind: "midplane", a: xy, b: onFace },
  },
  {
    ...base,
    id: "em",
    type: "emboss",
    profiles: [prof],
    depth: 0.5,
    mode: "deboss",
  },
  {
    ...base,
    id: "mv",
    type: "move",
    bodies: ["b1", "b2"],
    translation: [1, -2, 3],
  },
];

const updateFeature = vi.fn(async () => {});
const setError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  panels.length = 0;
  const doc = createEmptyDocument("d1", "Doc");
  doc.features = [sketch, ...cases];
  useStore.setState({
    document: doc,
    busy: false,
    mode: { name: "idle" },
    selection: [],
    dialogParams: {},
    updateFeature,
    setError,
  });
});

/** Render the open dialog and press its primary button. */
async function pressOk(): Promise<void> {
  panels.length = 0;
  // SSR reads zustand's server snapshot (initial state), so mirror the live state into it
  Object.assign(useStore.getInitialState(), useStore.getState());
  renderToString(createElement(FeatureDialog));
  const find = (n: any): any => {
    if (Array.isArray(n)) return n.map(find).find(Boolean);
    if (!n?.props) return undefined;
    if (n.type === "button" && n.props.className === "btn primary") return n;
    return find(n.props.children);
  };
  const ok = panels.map((p) => find(p.children)).find(Boolean);
  expect(ok, "OK button").toBeTruthy();
  ok.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
}

it.each(cases.map((f) => [f.id, f] as const))(
  "reopen + OK round-trips %s",
  async (_id, f) => {
    await openFeatureEditor(f);
    const s = useStore.getState();
    expect(s.mode).toEqual({
      name: "dialog",
      dialog: f.type,
      editFeatureId: f.id,
    });
    // everything reopen selects is pickable in that dialog
    expect(filterSelectionFor(f.type as any, s.selection)).toEqual(s.selection);
    await pressOk();
    expect(setError).not.toHaveBeenCalled();
    const { id: _ignored, suppressed: _kept, ...patch } = f;
    expect(updateFeature).toHaveBeenCalledWith(f.id, patch);
  },
);

it("reopen keeps a reference image's placement", async () => {
  const img: Feature = {
    ...base,
    id: "ri",
    type: "referenceImage",
    plane: xy,
    assetId: "a1",
    fileName: "x.png",
    transform: { u: 1, v: 2, rotation: 30, scale: 0.25 },
    opacity: 0.4,
    visible: true,
    width: 100,
    height: 50,
  };
  useStore.getState().document!.features.push(img);
  await openFeatureEditor(img);
  await pressOk();
  expect(updateFeature).toHaveBeenCalledWith("ri", {
    opacity: 0.4,
    transform: img.transform,
  });
});

it("reopen of a sketch enters sketch editing instead of a dialog", async () => {
  const editSketch = vi.fn(async () => {});
  useStore.setState({ editSketch });
  await openFeatureEditor(sketch);
  expect(editSketch).toHaveBeenCalledWith("sk1");
  expect(useStore.getState().mode).toEqual({ name: "idle" });
});

it("reopen + OK leaves the suppressed flag to the server", async () => {
  const f: Feature = {
    ...base,
    id: "sup",
    type: "offsetFace",
    faces: [face],
    distance: 1,
    suppressed: true,
  };
  await openFeatureEditor(f);
  await pressOk();
  expect(updateFeature).toHaveBeenCalledWith(
    "sup",
    expect.not.objectContaining({ suppressed: expect.anything() }),
  );
});

it("extrude without optional keys round-trips unchanged", async () => {
  const f: Feature = {
    ...base,
    id: "exBare",
    type: "extrude",
    profiles: [prof],
    distance: 10,
    direction: "normal",
    operation: "join",
  };
  useStore.getState().document!.features.push(f);
  await openFeatureEditor(f);
  await pressOk();
  const { id: _ignored, suppressed: _kept, ...patch } = f;
  expect(updateFeature).toHaveBeenCalledWith("exBare", patch);
});

it("extrude edit overwrites stored optional keys", async () => {
  const f = cases.find((c) => c.id === "ex")!;
  await openFeatureEditor(f);
  useStore.setState({
    selection: [{ kind: "profile", ...prof }],
    dialogParams: {
      ...useStore.getState().dialogParams,
      direction: "normal",
      startOffset: 0,
    },
  });
  await pressOk();
  expect(updateFeature).toHaveBeenCalledWith(
    "ex",
    expect.objectContaining({ faces: [], distance2: 4, startOffset: 0 }),
  );
});

it("tangentChain absent reopens as false and new defaults to true", async () => {
  const addFeature = vi.fn(async () => {});
  useStore.setState({ addFeature });
  const bare: Feature[] = [
    { ...base, id: "fiBare", type: "fillet", edges: [edge], radius: 3 },
    { ...base, id: "chBare", type: "chamfer", edges: [edge], distance: 2 },
  ];
  for (const f of bare) {
    useStore.getState().document!.features.push(f);
    await openFeatureEditor(f);
    expect(useStore.getState().dialogParams.tangentChain).toBe(false);
    await pressOk();
    expect(updateFeature).toHaveBeenCalledWith(
      f.id,
      expect.objectContaining({ tangentChain: false }),
    );
    useStore.setState({
      mode: { name: "dialog", dialog: f.type as "fillet" | "chamfer" },
      selection: [edge],
      dialogParams: {},
    });
    await pressOk();
    expect(addFeature).toHaveBeenCalledWith(
      expect.objectContaining({ type: f.type, tangentChain: true }),
    );
  }
});
