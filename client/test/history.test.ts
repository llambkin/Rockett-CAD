import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type SketchFeature } from "@rockett/shared";
import { useStore } from "../src/store";
import { api } from "../src/api";
vi.mock("../src/api", () => ({ api: { replaceDocument: vi.fn() } }));

const sketch: SketchFeature = { id: "sk", type: "sketch", name: "Sketch", suppressed: false,
  plane: { kind: "origin", plane: "XY" }, entities: [{ id: "p", kind: "point", x: 5, y: 0 }], constraints: [] };
const doc = createEmptyDocument("history", "History"); doc.features = [sketch]; doc.timelinePosition = 1;
const evaluation = { bodies: [], planes: [], kernelMs: 0, featureStatuses: [], sketches: [{ featureId: "sk",
  frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  entities: [{ id: "p", kind: "point", x: 10, y: 0 }], solveStatus: "unconstrained", dof: 2, profiles: [] }] };

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ document: doc, projectId: doc.id, busy: false, undoStack: [doc], redoStack: [],
    mode: { name: "sketch", sketchId: "sk", tool: "line", constructionMode: true }, draftSketch: sketch,
    selection: [{ kind: "sketchPoint", sketchId: "sk", entityId: "p" }] });
  vi.mocked(api.replaceDocument).mockResolvedValue({ document: doc, evaluation } as any);
});

it("keeps undo and redo inside the sketch with authoritative solved coordinates", async () => {
  await useStore.getState().undo();
  expect(useStore.getState().mode).toEqual({ name: "sketch", sketchId: "sk", tool: "select", constructionMode: true });
  expect(useStore.getState().draftSketch!.entities[0]).toMatchObject({ x: 10 });
  expect(useStore.getState().selection).toEqual([]);
  await useStore.getState().redo();
  expect(useStore.getState().mode.name).toBe("sketch");
  expect(useStore.getState().draftSketch!.entities[0]).toMatchObject({ x: 10 });
  expect(useStore.getState().undoStack).toHaveLength(1);
});

it("exits cleanly when undo removes the sketch", async () => {
  vi.mocked(api.replaceDocument).mockResolvedValue({ document: { ...doc, features: [] }, evaluation: { ...evaluation, sketches: [] } } as any);
  await useStore.getState().undo();
  expect(useStore.getState().mode.name).toBe("idle");
  expect(useStore.getState().draftSketch).toBeNull();
});

it("ignores a second undo while the first request is pending", async () => {
  let complete!: (value: any) => void;
  vi.mocked(api.replaceDocument).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = useStore.getState().undo();
  await useStore.getState().undo();
  expect(api.replaceDocument).toHaveBeenCalledTimes(1);
  complete({ document: doc, evaluation });
  await pending;
  expect(useStore.getState().busy).toBe(false);
});
