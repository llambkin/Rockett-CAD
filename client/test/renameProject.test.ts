import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { useStore } from "../src/store";
import { api } from "../src/api";
vi.mock("../src/api", () => ({ api: { renameProject: vi.fn() } }));

const doc = createEmptyDocument("proj1", "Old name");
const evaluation = {
  bodies: [],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    document: doc,
    projectId: doc.id,
    evaluation: evaluation as any,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
  });
  vi.mocked(api.renameProject).mockImplementation(async (_id, name) => ({
    document: { ...doc, name },
  }));
});

it("renames the open project in place without touching evaluation or history", async () => {
  await useStore.getState().renameProject("  Bracket v2 ");
  expect(api.renameProject).toHaveBeenCalledWith("proj1", "Bracket v2");
  const s = useStore.getState();
  expect(s.document!.name).toBe("Bracket v2");
  expect(s.evaluation).toBe(evaluation);
  expect(s.undoStack).toHaveLength(0);
  expect(s.busy).toBe(false);
});

it("ignores empty and unchanged names", async () => {
  await useStore.getState().renameProject("   ");
  await useStore.getState().renameProject("Old name");
  expect(api.renameProject).not.toHaveBeenCalled();
  expect(useStore.getState().document!.name).toBe("Old name");
});

it("surfaces a server failure as the store error and keeps the old name", async () => {
  vi.mocked(api.renameProject).mockRejectedValue(new Error("boom"));
  await useStore.getState().renameProject("New");
  expect(useStore.getState().document!.name).toBe("Old name");
  expect(useStore.getState().error).toBe("boom");
});
