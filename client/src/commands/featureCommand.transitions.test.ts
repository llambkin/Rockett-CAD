import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type EvaluateResult,
  type SketchFeature,
} from "@rockett/shared";
import { api } from "../api";
import { useStore } from "../store";
import { openFeatureEditor } from "../components/Timeline";
import { runCommand } from "./registry";
import "../features/core";
import "./design";
import { sketchState } from "./sketch";

vi.mock("../api", () => ({
  watchUnauthorized: vi.fn(),
  api: {
    evaluate: vi.fn(),
    addFeature: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    restoreHistory: vi.fn(),
  },
}));

const initial = useStore.getState();
const sketch: SketchFeature = {
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
};
const evaluation: EvaluateResult = {
  bodies: [],
  planes: [],
  featureStatuses: [],
  kernelMs: 0,
  sketches: [
    {
      featureId: "sk",
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
      entities: [],
      profiles: [],
      dof: 0,
      solveStatus: "fully_constrained",
    },
  ],
};
beforeEach(() => {
  useStore.setState(initial, true);
  vi.resetAllMocks();
  const document = createEmptyDocument("project", "Project");
  document.features = [sketch];
  document.timelinePosition = 1;
  useStore.setState({
    projectId: document.id,
    document,
    evaluation,
    history: {
      canUndo: true,
      canRedo: true,
      undoLabel: "Undo",
      redoLabel: "Redo",
    },
  });
  vi.mocked(api.evaluate).mockResolvedValue(evaluation);
  for (const move of [api.undo, api.redo, api.restoreHistory])
    vi.mocked(move).mockResolvedValue({ document, evaluation });
  vi.mocked(api.addFeature).mockImplementation(async (_id, feature) => ({
    document: { ...document, features: [...document.features, feature] },
    evaluation,
  }));
});
afterEach(() => useStore.setState(initial, true));

it.each(["design.chamfer", "design.export", "design.sketch.create"])(
  "opening a healthy sketch replaces %s",
  async (id) => {
    await runCommand(id);
    await openFeatureEditor(sketch);
    expect(useStore.getState().active).toEqual({
      id: "design.sketch",
      state: sketchState("sk", "select"),
    });
    expect(useStore.getState().draftSketch).toEqual(sketch);
  },
);

it.each(["design.chamfer", "design.export", "design.sketch.create"])(
  "starting a sketch replaces %s after the mutation succeeds",
  async (id) => {
    await runCommand(id);
    await useStore
      .getState()
      .startSketchOnPlane({ kind: "origin", plane: "XY" });
    expect(api.addFeature).toHaveBeenCalledOnce();
    expect(useStore.getState().active?.id).toBe("design.sketch");
    expect(useStore.getState().draftSketch?.id).toBe(
      useStore.getState().document?.features.at(-1)?.id,
    );
  },
);

it.each(["undo", "redo", "restore"] as const)(
  "successful %s closes a feature command",
  async (move) => {
    await runCommand("design.chamfer");
    if (move === "restore") await useStore.getState().restore("snapshot");
    else await useStore.getState()[move]();
    expect(useStore.getState().active).toBeNull();
    expect(useStore.getState().selection).toEqual([]);
  },
);

it.each(["busy", "missing", "suppressed", "failure"] as const)(
  "refused sketch edit ($0) preserves the current command",
  async (reason) => {
    await runCommand("design.chamfer");
    const owner = useStore.getState().active;
    if (reason === "busy") useStore.setState({ busy: true });
    if (reason === "suppressed")
      useStore.getState().document!.features[0]!.suppressed = true;
    if (reason === "failure")
      vi.mocked(api.evaluate).mockRejectedValue(new Error("refused"));
    await useStore
      .getState()
      .editSketch(reason === "missing" ? "absent" : "sk");
    expect(useStore.getState().active).toBe(owner);
  },
);
