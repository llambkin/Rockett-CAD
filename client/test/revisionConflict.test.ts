import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type ExtrudeFeature,
  type Feature,
} from "@rockett/shared";
import { api } from "../src/api";
import { useStore } from "../src/store";

const evaluation = {
  bodies: [],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
};

const feature = (id: string, name: string) =>
  ({
    id,
    type: "extrude",
    name,
    suppressed: false,
    profiles: [],
    distance: 10,
    direction: "normal",
    operation: "newBody",
  }) as unknown as ExtrudeFeature;

interface Sent {
  method: string;
  path: string;
  ifMatch: string | null;
}

let stored: CadDocument;
let sent: Sent[];
let offline: boolean;
let held: Array<() => void> | null;
let project = 0;

function otherTab(change: (doc: CadDocument) => void) {
  const next = structuredClone(stored);
  change(next);
  next.revision = stored.revision + 1;
  stored = next;
}

const named = (doc: CadDocument | null | undefined, id: string) =>
  doc?.features.find((f) => f.id === id)?.name;

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

async function release() {
  while (held?.length) {
    held.shift()!();
    await flush();
  }
}

function serve(method: string, path: string, init: RequestInit) {
  if (method === "GET" && path === `/projects/${stored.id}`)
    return Response.json({ document: stored });
  if (method === "GET" && path === `/projects/${stored.id}/evaluate`)
    return Response.json(evaluation);
  const ifMatch = new Headers(init.headers).get("If-Match");
  if (ifMatch !== `"${stored.revision}"`)
    return Response.json(
      {
        error: "This project changed since you last loaded it.",
        code: "conflict",
        revision: stored.revision,
      },
      { status: 409 },
    );
  const next = structuredClone(stored);
  const match = /^\/projects\/[^/]+\/features\/([^/]+)$/.exec(path);
  if (method !== "PUT" || !match) throw new Error(`${method} ${path}`);
  const body = JSON.parse(String(init.body)) as { feature: Partial<Feature> };
  next.features = next.features.map((f) =>
    f.id === match[1] ? ({ ...f, ...body.feature } as Feature) : f,
  );
  next.revision++;
  stored = next;
  return Response.json({ document: stored, evaluation });
}

beforeEach(async () => {
  stored = {
    ...createEmptyDocument(`p${++project}`, "Part"),
    features: [feature("a", "A0"), feature("b", "B0")],
    timelinePosition: 2,
    revision: 3,
  };
  sent = [];
  offline = false;
  held = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = url.replace(/^\/api/, "").split("?")[0]!;
      sent.push({
        method,
        path,
        ifMatch: new Headers(init.headers).get("If-Match"),
      });
      if (offline) throw new TypeError("Failed to fetch");
      if (held && method !== "GET")
        await new Promise<void>((resolve) => held!.push(resolve));
      return serve(method, path, init);
    }),
  );
  useStore.getState().closeProject();
  const { document } = await api.getProject(stored.id);
  useStore.setState({
    projectId: document.id,
    document,
    evaluation: evaluation as any,
  });
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const edits = () => sent.filter((s) => s.method !== "GET");

it("sends two quick edits in order, each from the revision before it", async () => {
  held = [];
  const s = useStore.getState();
  const first = s.updateFeature("a", { name: "A1" });
  const second = s.updateFeature("a", { name: "A2" });
  await flush();
  expect(edits()).toHaveLength(1);
  await release();
  await Promise.all([first, second]);
  expect(edits().map((e) => e.ifMatch)).toEqual(['"3"', '"4"']);
  const state = useStore.getState();
  expect(named(state.document, "a")).toBe("A2");
  expect(named(stored, "a")).toBe("A2");
  expect(state.undoStack.map((d) => named(d, "a"))).toEqual(["A0", "A1"]);
  expect(state.saveState).toBe("saved");
});

it("keeps a conflicting edit until the user reapplies it on the other tab's work", async () => {
  otherTab((doc) => (doc.features[1]!.name = "B-theirs"));
  await useStore
    .getState()
    .updateFeature("a", { name: "A-mine" })
    .catch(() => {});
  const state = useStore.getState();
  expect(state.recovery?.kind).toBe("conflict");
  expect(state.saveState).toBe("unsaved");
  expect(named(state.document, "b")).toBe("B0");
  expect(sent.filter((s) => s.method === "GET")).toHaveLength(0);
  await state.recover("reapply");
  const after = useStore.getState();
  expect(after.recovery).toBeNull();
  expect(named(stored, "a")).toBe("A-mine");
  expect(named(stored, "b")).toBe("B-theirs");
  expect(named(after.document, "a")).toBe("A-mine");
  expect(named(after.document, "b")).toBe("B-theirs");
  expect(after.saveState).toBe("saved");
});

it("holds later edits while a conflict waits and keeps the undo history on discard", async () => {
  await useStore.getState().updateFeature("a", { name: "A1" });
  otherTab((doc) => (doc.features[1]!.name = "B-theirs"));
  await useStore
    .getState()
    .updateFeature("a", { name: "A2" })
    .catch(() => {});
  await useStore
    .getState()
    .updateFeature("a", { name: "A3" })
    .catch(() => {});
  expect(edits()).toHaveLength(2);
  await useStore.getState().recover("discard");
  const state = useStore.getState();
  expect(state.recovery).toBeNull();
  expect(named(state.document, "a")).toBe("A1");
  expect(named(state.document, "b")).toBe("B-theirs");
  expect(state.undoStack.map((d) => named(d, "a"))).toEqual(["A0"]);
  expect(edits()).toHaveLength(2);
});

it("keeps an offline edit as unsaved and sends it when the user retries", async () => {
  offline = true;
  await useStore
    .getState()
    .updateFeature("a", { name: "A-offline" })
    .catch(() => {});
  expect(useStore.getState().recovery?.kind).toBe("offline");
  expect(useStore.getState().saveState).toBe("unsaved");
  offline = false;
  await useStore.getState().recover("reapply");
  expect(named(stored, "a")).toBe("A-offline");
  expect(named(useStore.getState().document, "a")).toBe("A-offline");
  expect(useStore.getState().saveState).toBe("saved");
});

it("stops previews on a conflict so none overwrites the chosen document", async () => {
  held = [];
  const s = useStore.getState();
  void s.updateFeaturePreview("a", { name: "P1" } as Partial<Feature>);
  await flush();
  otherTab((doc) => (doc.features[1]!.name = "B-theirs"));
  void s.updateFeaturePreview("a", { name: "P2" } as Partial<Feature>);
  await release();
  expect(useStore.getState().recovery?.kind).toBe("conflict");
  void useStore
    .getState()
    .updateFeaturePreview("a", { name: "P3" } as Partial<Feature>);
  await flush();
  expect(edits()).toHaveLength(1);
  await useStore.getState().recover("discard");
  await flush();
  const state = useStore.getState();
  expect(edits()).toHaveLength(1);
  expect(named(state.document, "a")).toBe("A0");
  expect(named(state.document, "b")).toBe("B-theirs");
  expect(state.previewBaseline).toBeNull();
});
