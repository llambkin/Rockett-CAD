import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { SketchFeature } from "@rockett/shared";
import { Toolbar } from "../../src/components/Toolbar";
import { useStore } from "../../src/store";

const sketch: SketchFeature = {
  id: "s1",
  type: "sketch",
  name: "Sketch1",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [
    { id: "c0", kind: "point", x: 0, y: 0 },
    { id: "circle", kind: "circle", center: "c0", radius: 10 },
    { id: "a", kind: "point", x: 1, y: 0 },
    { id: "b", kind: "point", x: 9.5, y: 0 },
    { id: "line", kind: "line", p1: "a", p2: "b" },
    { id: "q", kind: "point", x: 5, y: 3 },
  ],
  constraints: [],
};

async function coincident(
  picks: Array<["sketchPoint" | "sketchEntity", string]>,
) {
  useStore.setState({
    document: null,
    mode: {
      name: "sketch",
      sketchId: "s1",
      tool: "select",
      constructionMode: false,
    },
    draftSketch: structuredClone(sketch),
    error: null,
    selection: picks.map(([kind, entityId]) => ({
      kind,
      sketchId: "s1",
      entityId,
    })),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Toolbar />));
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.title.startsWith("Coincident"),
  );
  await act(async () => button!.click());
  await act(async () => root.unmount());
  host.remove();
  const state = useStore.getState();
  return { added: state.draftSketch!.constraints, error: state.error };
}

it("puts the selected line end on the selected circle", async () => {
  const { added } = await coincident([
    ["sketchEntity", "circle"],
    ["sketchEntity", "line"],
    ["sketchPoint", "b"],
  ]);
  expect(added).toMatchObject([
    { type: "pointOnCircle", point: "b", circle: "circle" },
  ]);
});

it("puts the line end nearer the curve on the circle", async () => {
  const { added } = await coincident([
    ["sketchEntity", "line"],
    ["sketchEntity", "circle"],
  ]);
  expect(added).toMatchObject([
    { type: "pointOnCircle", point: "b", circle: "circle" },
  ]);
});

it("puts a point on a line", async () => {
  const { added } = await coincident([
    ["sketchPoint", "q"],
    ["sketchEntity", "line"],
  ]);
  expect(added).toMatchObject([
    { type: "pointOnLine", point: "q", line: "line" },
  ]);
});

it("refuses a line's own end on that line", async () => {
  const { added, error } = await coincident([
    ["sketchPoint", "a"],
    ["sketchEntity", "line"],
  ]);
  expect(added).toEqual([]);
  expect(error).toMatch(/coincident/);
});

it("still joins two points", async () => {
  const { added } = await coincident([
    ["sketchPoint", "q"],
    ["sketchPoint", "b"],
  ]);
  expect(added).toMatchObject([{ type: "coincident", a: "q", b: "b" }]);
});
