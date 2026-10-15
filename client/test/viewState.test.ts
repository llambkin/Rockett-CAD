import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { useStore } from "../src/store";
import { setBodiesVisible, setFeaturesVisible } from "../src/treeSelection";

const calls = vi.hoisted(() => [] as [string, unknown[]][]);

vi.mock("../src/api", () => ({
  api: new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        async (...args: unknown[]) => {
          calls.push([name, args]);
          return args[1];
        },
    },
  ),
}));

const doc = createEmptyDocument("p1", "Part");
doc.features = [
  {
    id: "s1",
    type: "sketch",
    name: "Sketch1",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [],
    constraints: [],
  } as Feature,
];
doc.timelinePosition = 1;

const evaluation = {
  bodies: [
    { bodyId: "b1", name: "Body1", visible: true },
    { bodyId: "b2", name: "Body2", visible: true },
  ],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
} as any;

beforeEach(() => {
  calls.length = 0;
  useStore.setState({
    projectId: "p1",
    document: doc,
    evaluation,
    view: { version: 1, hidden: { bodies: [], features: [] } },
    undoStack: [],
    redoStack: [],
    busy: false,
    error: null,
    recovery: null,
  });
});

it("hides a body through the view API alone, with no undo entry or evaluation", async () => {
  await setBodiesVisible({ b1: false });
  const s = useStore.getState();
  expect(calls).toEqual([
    [
      "putView",
      ["p1", { version: 1, hidden: { bodies: ["b1"], features: [] } }],
    ],
  ]);
  expect(s.undoStack).toHaveLength(0);
  expect(s.evaluation).toBe(evaluation);
  expect(s.document).toBe(doc);
  expect(s.view.hidden.bodies).toEqual(["b1"]);
});

it("hides a sketch through the view API alone", async () => {
  await setFeaturesVisible(["s1"], false);
  expect(calls).toEqual([
    [
      "putView",
      ["p1", { version: 1, hidden: { bodies: [], features: ["s1"] } }],
    ],
  ]);
  expect(useStore.getState().undoStack).toHaveLength(0);
  expect(useStore.getState().evaluation).toBe(evaluation);
});

it("shows every body again with one view write", async () => {
  useStore.setState({
    view: { version: 1, hidden: { bodies: ["b1", "b2"], features: ["s1"] } },
  });
  await setBodiesVisible({ b1: true, b2: true });
  expect(calls).toEqual([
    [
      "putView",
      ["p1", { version: 1, hidden: { bodies: [], features: ["s1"] } }],
    ],
  ]);
});

it("sends documents and feature edits without visibility flags", async () => {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(`${init.body}`);
      return Response.json({
        document: doc,
        evaluation: { ...evaluation, bodies: [] },
      });
    }),
  );
  const { api } =
    await vi.importActual<typeof import("../src/api")>("../src/api");
  await api.replaceDocument("p1", {
    ...doc,
    features: doc.features.map((f) => ({ ...f, visible: false })),
  });
  await api.updateFeature("p1", "s1", {
    name: "Top",
    visible: true,
  } as Partial<Feature>);
  vi.unstubAllGlobals();
  expect(sent).toHaveLength(2);
  expect(sent.join()).toContain('"name":"Top"');
  expect(sent.join()).not.toContain("visible");
});
