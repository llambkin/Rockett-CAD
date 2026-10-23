import { beforeEach, expect, it, vi } from "vitest";
import type { SketchFeature } from "@rockett/shared";
import { useStore } from "../src/store";
import { insertPlaneFor } from "../src/sketchImport";

const sketch: SketchFeature = {
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
};
const imported = {
  entities: [
    { id: "a", kind: "point" as const, x: 0, y: 0 },
    { id: "b", kind: "point" as const, x: 20, y: 10 },
    { id: "ab", kind: "line" as const, p1: "a", p2: "b" },
  ],
  skipped: 0,
};
const evaluation = {
  bodies: [
    {
      bodyId: "b1",
      faces: [
        { name: "top", surface: { type: "plane" } },
        { name: "side", surface: { type: "cylinder" } },
      ],
    },
  ],
} as any;

const original = useStore.getState();
beforeEach(() => {
  useStore.setState({
    ...original,
    mode: {
      name: "sketch",
      sketchId: "sk",
      tool: "select",
      constructionMode: false,
    },
    draftSketch: structuredClone(sketch),
    evaluation,
    selection: [],
    sketchImport: null,
    error: null,
    busy: false,
  });
});

it("holds an import for placement, then inserts it moved, scaled and rotated", async () => {
  const insert = vi.fn(async () => {});
  useStore.setState({ insertSketchImport: insert });
  useStore.getState().beginSketchImport("SVG", imported, false);
  expect(useStore.getState().sketchImport).toMatchObject({
    format: "SVG",
    created: false,
  });
  await useStore
    .getState()
    .placeSketchImport({ scale: 2, rotation: 90, x: 5, y: 5 });
  expect(useStore.getState().sketchImport).toBeNull();
  const [format, placed] = (insert.mock.calls[0] as any[])!;
  expect(format).toBe("SVG");
  const a = placed.entities.find((e: any) => e.id === "a");
  expect(a.x).toBeCloseTo(15, 9);
  expect(a.y).toBeCloseTo(-15, 9);
});

it("cancelling an import into a sketch it created removes that empty sketch", async () => {
  const undo = vi.fn(async () => {});
  useStore.setState({ undo });
  useStore.getState().beginSketchImport("SVG", imported, true);
  await useStore.getState().cancelSketchImport();
  expect(useStore.getState().sketchImport).toBeNull();
  expect(undo).toHaveBeenCalledTimes(1);
  useStore.getState().beginSketchImport("SVG", imported, false);
  await useStore.getState().cancelSketchImport();
  expect(undo).toHaveBeenCalledTimes(1);
});

it("an empty file reports its error without opening placement", () => {
  useStore
    .getState()
    .beginSketchImport("SVG", { entities: [], skipped: 2 }, false);
  expect(useStore.getState().sketchImport).toBeNull();
  expect(useStore.getState().error).toMatch(
    /no lines, arcs, circles or points/,
  );
});

it("finds the sketch plane for Insert SVG from a selected planar face or plane only", () => {
  expect(
    insertPlaneFor(
      [{ kind: "face", bodyId: "b1", faceName: "top" }],
      evaluation,
    ),
  ).toEqual({
    kind: "face",
    face: { kind: "face", bodyId: "b1", faceName: "top" },
  });
  expect(
    insertPlaneFor(
      [{ kind: "face", bodyId: "b1", faceName: "side" }],
      evaluation,
    ),
  ).toBeNull();
  const plane = { kind: "origin" as const, plane: "XZ" as const };
  expect(
    insertPlaneFor([{ kind: "plane", ref: plane, label: "XZ" }], evaluation),
  ).toEqual(plane);
  expect(insertPlaneFor([], evaluation)).toBeNull();
});

it("inserting an SVG on a selected face starts a sketch there and opens placement", async () => {
  const start = vi.fn(async () => {
    useStore.setState({
      mode: {
        name: "sketch",
        sketchId: "new",
        tool: "line",
        constructionMode: false,
      },
      draftSketch: { ...sketch, id: "new" },
    });
  });
  useStore.setState({
    mode: { name: "idle" },
    draftSketch: null,
    startSketchOnPlane: start,
    selection: [{ kind: "face", bodyId: "b1", faceName: "top" }],
  });
  await useStore.getState().insertSvgOnSelection(imported);
  expect(start).toHaveBeenCalledWith({
    kind: "face",
    face: { kind: "face", bodyId: "b1", faceName: "top" },
  });
  expect(useStore.getState().mode).toMatchObject({
    name: "sketch",
    tool: "select",
  });
  expect(useStore.getState().sketchImport).toMatchObject({
    format: "SVG",
    created: true,
  });
});

it("refuses Insert SVG without a planar face or plane selected", async () => {
  const start = vi.fn();
  useStore.setState({
    mode: { name: "idle" },
    startSketchOnPlane: start,
    selection: [],
  });
  await useStore.getState().insertSvgOnSelection(imported);
  expect(start).not.toHaveBeenCalled();
  expect(useStore.getState().error).toMatch(/Select a planar face or a plane/);
});
