import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type SketchFeature } from "@rockett/shared";
import { useStore } from "../src/store";
import { api } from "../src/api";
vi.mock("../src/api", () => ({
  api: { evaluate: vi.fn(), updateFeature: vi.fn(), replaceDocument: vi.fn() },
}));

const sketch: SketchFeature = {
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [
    { id: "p", kind: "point", x: 0, y: 0 },
    { id: "circle", kind: "circle", center: "p", radius: 10 },
  ],
  constraints: [],
};
const doc = {
  ...createEmptyDocument("editing", "Editing"),
  features: [
    sketch,
    {
      id: "ext",
      type: "extrude",
      name: "Extrude",
      suppressed: false,
      profiles: [],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    },
  ],
  timelinePosition: 2,
} as any;
const sketchEvaluation = {
  bodies: [],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [
    {
      featureId: "sk",
      entities: sketch.entities,
      profiles: [],
      dof: 3,
      solveStatus: "unconstrained",
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
    },
  ],
} as any;
const fullEvaluation = { ...sketchEvaluation, bodies: [{ bodyId: "b:ext" }] };

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    document: structuredClone(doc),
    projectId: doc.id,
    mode: { name: "idle" },
    evaluation: fullEvaluation,
    draftSketch: null,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
  });
  vi.mocked(api.evaluate).mockImplementation(async (_id, position) =>
    position === 1 ? sketchEvaluation : fullEvaluation,
  );
  vi.mocked(api.updateFeature).mockImplementation(async (_id, _fid, patch) => ({
    document: { ...doc, features: [{ ...sketch, ...patch }, doc.features[1]] },
    evaluation: {
      ...sketchEvaluation,
      sketches: [
        { ...sketchEvaluation.sketches[0], entities: (patch as any).entities },
      ],
    },
  }));
});

it("rewinds only the evaluation while editing, then restores the prior timeline", async () => {
  await useStore.getState().editSketch("sk");
  expect(api.evaluate).toHaveBeenCalledWith(doc.id, 1);
  expect(useStore.getState().evaluation!.bodies).toEqual([]);
  expect(useStore.getState().document!.timelinePosition).toBe(2);
  expect(useStore.getState().undoStack).toHaveLength(0);
  await useStore.getState().finishSketch();
  expect(api.updateFeature).not.toHaveBeenCalled();
  expect(useStore.getState().undoStack).toHaveLength(0);
  expect(api.evaluate).toHaveBeenLastCalledWith(doc.id);
  expect(useStore.getState().evaluation).toEqual(fullEvaluation);
  expect(useStore.getState().mode.name).toBe("idle");
});

it("does not enter editing if the temporary rollback fails", async () => {
  vi.mocked(api.evaluate).mockRejectedValue(new Error("Disconnected"));
  await useStore.getState().editSketch("sk");
  expect(useStore.getState().mode.name).toBe("idle");
  expect(useStore.getState().evaluation).toEqual(fullEvaluation);
  expect(useStore.getState().busy).toBe(false);
});

it("keeps the draft editable when finishing fails", async () => {
  await useStore.getState().editSketch("sk");
  useStore.setState({
    draftSketch: {
      ...sketch,
      entities: [
        ...sketch.entities,
        { id: "extra", kind: "point", x: 4, y: 5 },
      ],
    },
  });
  vi.mocked(api.updateFeature).mockRejectedValue(new Error("Save failed"));
  await useStore.getState().finishSketch();
  expect(useStore.getState().mode.name).toBe("sketch");
  expect(useStore.getState().draftSketch).not.toBeNull();
  expect(useStore.getState().error).toBe("Save failed");
});

it("saves offset metadata and distance edits as undoable changes while rolled back", async () => {
  await useStore.getState().editSketch("sk");
  await useStore.getState().createOffset(["circle"], 2, true, 0.01);
  const offset = useStore.getState().draftSketch!.offsets![0]!;
  await useStore.getState().editOffset(offset.id, 4);
  expect(useStore.getState().document!.features[0]).toMatchObject({
    offsets: [{ distance: 4 }],
  });
  expect(useStore.getState().undoStack.at(-1)!.features[0]).toMatchObject({
    offsets: [{ distance: 2 }],
  });
  expect(api.updateFeature).toHaveBeenLastCalledWith(
    doc.id,
    "sk",
    expect.objectContaining({
      offsets: [expect.objectContaining({ distance: 4 })],
    }),
    1,
  );
});

it("edits an offset while an unrelated dimension conflict exists", async () => {
  await useStore.getState().editSketch("sk");
  await useStore.getState().createOffset(["circle"], 2, true, 0.01);
  const draft = useStore.getState().draftSketch!;
  useStore.setState({
    draftSketch: {
      ...draft,
      entities: [
        ...draft.entities,
        { id: "q", kind: "point", x: 30, y: 0 },
        { id: "r", kind: "point", x: 35, y: 0 },
      ],
      constraints: [
        { id: "fq", type: "fix", point: "q" },
        { id: "fr", type: "fix", point: "r" },
        { id: "qr", type: "distance", a: "q", b: "r", axis: null, value: 9 },
      ],
    },
  });
  const offset = draft.offsets![0]!;
  await useStore.getState().editOffset(offset.id, 4);
  const after = useStore.getState().draftSketch!;
  expect(after.offsets![0]!.distance).toBe(4);
  expect(
    after.entities.find((e) => e.id === offset.entityIds.at(-1)),
  ).toMatchObject({ radius: 14 });
});

it("resizes an offset when its source is resized", async () => {
  await useStore.getState().editSketch("sk");
  await useStore.getState().createOffset(["circle"], 2, true, 0.01);
  const draft = useStore.getState().draftSketch!;
  const offset = draft.offsets![0]!;
  useStore
    .getState()
    .updateDraftSketch(draft.entities, [
      ...draft.constraints,
      { id: "rad", type: "radius", entity: "circle", value: 15 },
    ]);
  const follower = useStore
    .getState()
    .draftSketch!.entities.find((e) => e.id === offset.entityIds.at(-1));
  expect(follower?.kind === "circle" && follower.radius).toBeCloseTo(17, 6);
});

it("refuses a dimension value that over-constrains a sketch that solved", async () => {
  await useStore.getState().editSketch("sk");
  const draft = useStore.getState().draftSketch!;
  const constraints = [
    ...draft.constraints,
    { id: "r1", type: "radius" as const, entity: "circle", value: 10 },
    { id: "fixc", type: "fix" as const, point: "p" },
  ];
  useStore.getState().updateDraftSketch(draft.entities, constraints);
  const solved = useStore.getState().draftSketch!;
  const applied = useStore
    .getState()
    .editDimensions([
      ...solved.constraints,
      { id: "r2", type: "diameter", entity: "circle", value: 30 },
    ]);
  expect(applied).toBe(false);
  expect(useStore.getState().draftSketch).toBe(solved);
  expect(useStore.getState().error).toMatch(/conflicts with other dimensions/);
  expect(
    useStore
      .getState()
      .editDimensions(
        solved.constraints.map((c) =>
          c.id === "r1" ? { ...c, value: 12 } : c,
        ),
      ),
  ).toBe(true);
  const circle = useStore
    .getState()
    .draftSketch!.entities.find((e) => e.id === "circle");
  expect(circle?.kind === "circle" && circle.radius).toBeCloseTo(12, 6);
});

it("undo during editing retains the temporary evaluation position", async () => {
  await useStore.getState().editSketch("sk");
  useStore.setState({ undoStack: [doc] });
  vi.mocked(api.replaceDocument).mockResolvedValue({
    document: doc,
    evaluation: sketchEvaluation,
  });
  await useStore.getState().undo();
  expect(api.replaceDocument).toHaveBeenCalledWith(doc.id, doc, 1);
  expect(useStore.getState().mode.name).toBe("sketch");
});
