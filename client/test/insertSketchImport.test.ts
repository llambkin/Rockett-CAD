import { beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  importDxf,
  type SketchFeature,
} from "@rockett/shared";
import { useStore } from "../src/store";
import { api } from "../src/api";
vi.mock("../src/api", () => ({
  api: { updateFeature: vi.fn(), replaceDocument: vi.fn() },
}));

const sketch: SketchFeature = {
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [{ id: "p", kind: "point", x: 3, y: 4 }],
  constraints: [],
};
const doc = {
  ...createEmptyDocument("insert", "Insert"),
  features: [sketch],
  timelinePosition: 1,
} as any;
const evaluationFor = (entities: unknown) =>
  ({
    bodies: [],
    planes: [],
    kernelMs: 0,
    featureStatuses: [],
    sketches: [
      {
        featureId: "sk",
        entities,
        profiles: [],
        dof: 0,
        solveStatus: "unconstrained",
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
      },
    ],
  }) as any;

const entities = (...records: string[][]) =>
  ["0", "SECTION", "2", "ENTITIES", ...records.flat(), "0", "ENDSEC"].join(
    "\n",
  );
const line = (x1: number, y1: number, x2: number, y2: number) =>
  ["0", "LINE", "10", x1, "20", y1, "11", x2, "21", y2].map(String);
const spline = ["0", "SPLINE", "10", "0", "20", "0"];

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    document: structuredClone(doc),
    projectId: doc.id,
    mode: {
      name: "sketch",
      sketchId: "sk",
      tool: "select",
      constructionMode: false,
    },
    evaluation: evaluationFor(sketch.entities),
    draftSketch: structuredClone(sketch),
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
  });
  vi.mocked(api.updateFeature).mockImplementation(async (_id, _fid, patch) => ({
    document: { ...doc, features: [{ ...sketch, ...patch }] },
    evaluation: evaluationFor((patch as SketchFeature).entities),
  }));
  vi.mocked(api.replaceDocument).mockImplementation(async (_id, next) => ({
    document: next,
    evaluation: evaluationFor((next.features[0] as SketchFeature).entities),
  }));
});

it("adds a DXF drawing to the draft as one undoable change", async () => {
  const square = importDxf(
    entities(
      line(0, 0, 10, 0),
      line(10, 0, 10, 10),
      line(10, 10, 0, 10),
      line(0, 10, 0, 0),
    ),
  );
  await useStore.getState().insertSketchImport("DXF", square);

  expect(api.updateFeature).toHaveBeenCalledTimes(1);
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(useStore.getState().draftSketch!.entities).toHaveLength(9);
  expect(useStore.getState().error).toBeNull();

  await useStore.getState().undo();
  expect(useStore.getState().draftSketch!.entities).toEqual(sketch.entities);
});

it("reports how many DXF entities were skipped", async () => {
  await useStore
    .getState()
    .insertSketchImport("DXF", importDxf(entities(line(0, 0, 5, 0), spline)));

  expect(useStore.getState().draftSketch!.entities).toHaveLength(4);
  expect(useStore.getState().error).toBe("Skipped 1 unsupported DXF entity.");
});

it("changes nothing when the file has no usable entities", async () => {
  await useStore
    .getState()
    .insertSketchImport("DXF", importDxf(entities(spline, spline)));

  expect(api.updateFeature).not.toHaveBeenCalled();
  expect(useStore.getState().undoStack).toHaveLength(0);
  expect(useStore.getState().draftSketch).toEqual(sketch);
  expect(useStore.getState().error).toBe(
    "This DXF file has no lines, arcs, circles or points to insert. Skipped 2 unsupported DXF entities.",
  );
});
