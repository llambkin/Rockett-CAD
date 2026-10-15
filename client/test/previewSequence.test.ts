import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type CadDocument } from "@rockett/shared";
import { useStore } from "../src/store";
import { api, type MutationResponse } from "../src/api";
vi.mock("../src/api", () => ({
  api: { updateFeature: vi.fn(), replaceDocument: vi.fn() },
}));

interface Reply {
  label: string;
  resolve: (m: MutationResponse) => void;
}

const base = createEmptyDocument("proj", "base");
const evaluation = {
  bodies: [],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
};
const docNamed = (name: string): CadDocument => ({ ...base, name });
const respond = (name: string) =>
  ({ document: docNamed(name), evaluation }) as any as MutationResponse;

let open: Reply[];

function defer(label: string): Promise<MutationResponse> {
  return new Promise((resolve) => open.push({ label, resolve }));
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function settleNewestFirst() {
  while (open.length) {
    const reply = open.pop()!;
    reply.resolve(respond(reply.label));
    await flush();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  open = [];
  useStore.setState({
    projectId: base.id,
    document: base,
    evaluation: evaluation as any,
    previewBaseline: null,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
  });
  vi.mocked(api.updateFeature).mockImplementation((_p, _f, patch) =>
    defer(JSON.stringify(patch)),
  );
  vi.mocked(api.replaceDocument).mockImplementation(() => defer("restored"));
});

it("keeps one preview in flight and applies only the newest", async () => {
  const s = useStore.getState();
  void s.updateFeaturePreview("f", { distance: 1 } as any);
  void s.updateFeaturePreview("f", { distance: 2 } as any);
  void s.updateFeaturePreview("f", { taper: 5 } as any);
  await flush();
  expect(api.updateFeature).toHaveBeenCalledTimes(1);
  await settleNewestFirst();
  expect(api.updateFeature).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.updateFeature).mock.calls[1]![2]).toEqual({
    distance: 2,
    taper: 5,
  });
  expect(useStore.getState().document!.name).toBe(
    JSON.stringify({ distance: 2, taper: 5 }),
  );
});

it("does not let a preview reply overwrite the cancel restore", async () => {
  void useStore.getState().updateFeaturePreview("f", { distance: 1 } as any);
  await flush();
  const cancelled = useStore.getState().cancelPreview();
  await settleNewestFirst();
  await cancelled;
  expect(useStore.getState().document!.name).toBe("restored");
  expect(useStore.getState().previewBaseline).toBeNull();
});

it("sends the cancel restore only after the in-flight preview settles", async () => {
  void useStore.getState().updateFeaturePreview("f", { distance: 1 } as any);
  await flush();
  const cancelled = useStore.getState().cancelPreview();
  await flush();
  expect(api.replaceDocument).not.toHaveBeenCalled();
  open.shift()!.resolve(respond("late"));
  await flush();
  expect(api.replaceDocument).toHaveBeenCalledWith(base.id, base);
  await settleNewestFirst();
  await cancelled;
  expect(useStore.getState().document!.name).toBe("restored");
});

it("commits only after the in-flight preview settles and ignores its reply", async () => {
  void useStore.getState().updateFeaturePreview("f", { distance: 1 } as any);
  await flush();
  const committed = useStore
    .getState()
    .mutate(() => api.updateFeature(base.id, "f", { distance: 9 } as any));
  await flush();
  expect(api.updateFeature).toHaveBeenCalledTimes(1);
  await settleNewestFirst();
  await committed;
  expect(useStore.getState().document!.name).toBe(
    JSON.stringify({ distance: 9 }),
  );
  expect(useStore.getState().undoStack).toEqual([base]);
});
