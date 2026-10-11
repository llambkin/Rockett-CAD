import "../commands/design";
import "./core";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { featureUI } from "./registry";
import { featureCommand } from "../commands/featureCommand";
import { activeCommand } from "../commands/active";
import { useStore, type Selection } from "../store";
import { base, edge, face } from "./featureUi.fixtures";

const vertex: Selection = { kind: "vertex", bodyId: "b1", vertexName: "v1" };
const top = face("b1", "f1");
const extrude: Selection = { kind: "feature", featureId: "ex1" };
const body: Selection = { kind: "body", bodyId: "b1" };
const modifiers = { shiftKey: false, ctrlKey: false, metaKey: false };
const refusals = {
  fillet: "Fillet rounds edges: pick the edges or faces at this corner",
  chamfer: "Chamfer bevels edges: pick the edges or faces at this corner",
};

afterEach(() => {
  useStore.getState().clearActive();
  useStore.setState({ selection: [], document: null, error: null });
});

describe.each(["fillet", "chamfer"] as const)("%s picks", (type) => {
  const sizes =
    type === "fillet"
      ? { filletType: "equalDistance", radius: 3 }
      : { chamferType: "equalDistance", distance: 2 };
  const stored = (picks: object) =>
    ({
      ...base,
      id: `${type}1`,
      type,
      tangentChain: true,
      ...sizes,
      ...picks,
    }) as Feature;
  const build = (selection: Selection[]) =>
    featureUI(type)!.create().withParams({}).build(selection);
  const open = () => {
    featureCommand.enter(type, { selection: [] });
    return activeCommand()!;
  };

  it("raycasts vertices but refuses a vertex click with its message", async () => {
    const command = open();
    expect(command.pickFilter()).toEqual([
      "design.vertex",
      "design.edge",
      "design.face",
      "design.feature",
    ]);
    await command.onClick(vertex, modifiers);
    expect(useStore.getState().selection).toEqual([]);
    expect(useStore.getState().error).toBe(refusals[type]);
  });

  it("takes a face click and a timeline feature pick but not its bodies", async () => {
    const command = open();
    await command.onClick(top, modifiers);
    command.onSelection!([extrude, body], false);
    expect(useStore.getState().selection).toEqual([top, extrude]);
    expect(build(useStore.getState().selection)).toMatchObject({
      edges: [],
      faces: [top],
      features: ["ex1"],
    });
  });

  it("builds edges, faces and features together", () => {
    expect(build([edge("e1"), top, extrude, vertex])).toMatchObject({
      edges: [edge("e1")],
      faces: [top],
      features: ["ex1"],
    });
  });

  it("keeps a new edge-only blend free of face and feature keys", () => {
    const built = build([edge("e1")]);
    expect(built).not.toHaveProperty("faces");
    expect(built).not.toHaveProperty("features");
  });

  it("sends empty faces when an edit removes every face", () => {
    const faced = stored({ edges: [], faces: [top] });
    const doc = createEmptyDocument("d1", "Doc");
    doc.features = [faced];
    useStore.setState({ document: doc });
    const { inputs } = featureUI(type)!.prefill!(faced);
    expect(inputs.build([edge("e1")])).toEqual({
      ...faced,
      edges: [edge("e1")],
      faces: [],
    });
  });

  it("prefills edge, face and feature picks", () => {
    const mixed = stored({
      edges: [edge("e1")],
      faces: [top],
      features: ["ex1"],
    });
    const { inputs, selection } = featureUI(type)!.prefill!(mixed);
    expect(selection).toEqual([edge("e1"), top, extrude]);
    expect(inputs.build(selection)).toEqual(mixed);
  });
});
