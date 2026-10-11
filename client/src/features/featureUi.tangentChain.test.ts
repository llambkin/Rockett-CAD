import "../commands/design";
import "./core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature } from "@rockett/shared";
import { featureUI, type SharedInputParams } from "./registry";
import { setFeatureParams } from "../commands/featureCommand";
import { useStore, type Selection } from "../store";
import { api } from "../api";
import { base, edge } from "./featureUi.fixtures";

describe.each(["fillet", "chamfer"] as const)("%s tangent chain", (type) => {
  const stored = { ...base, id: `${type}Bare`, edges: [edge("e1")] };
  const bare: Feature =
    type === "fillet"
      ? { ...stored, type, filletType: "equalDistance", radius: 3 }
      : { ...stored, type, chamferType: "equalDistance", distance: 2 };

  it("reopens a stored feature without tangentChain as false and writes false", () => {
    const ui = featureUI(type)!;
    const { inputs, selection } = ui.prefill!(bare);
    expect(inputs.params.tangentChain).toBe(false);
    expect(inputs.build(selection)).toEqual({
      ...bare,
      tangentChain: false,
    });
  });

  it("starts a new feature with tangentChain true", () => {
    const built = featureUI(type)!
      .create()
      .withParams({})
      .build([edge("e1")]);
    expect(built).toMatchObject({ type, tangentChain: true });
  });

  it("refuses to build without an edge, face or feature", () => {
    expect(featureUI(type)!.create().withParams({}).build([])).toEqual({
      error: "Select at least one edge, face or feature",
    });
  });

  const chain = [edge("e1"), edge("e2"), edge("e3")];
  const pick = (selection: Selection[], params: SharedInputParams = {}) => {
    useStore.setState({
      projectId: "p1",
      active: {
        id: "design.feature",
        state: {
          type: type,
          selectionBefore: [],
          editFeatureId: "f9",
          inputs: featureUI(type)!.create().withParams(params),
        },
      },
      selection,

      setError: vi.fn(),
    });
    const active = useStore.getState().active;
    if (active?.id !== "design.feature")
      throw new Error("Expected feature inputs");
    return active.state.inputs.onPick(
      edge("e1"),
      useStore.getState(),
      setFeatureParams,
    );
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "tangentEdges").mockResolvedValue({ edges: chain } as never);
  });

  it("adds the tangent chain of a picked edge", async () => {
    await pick([{ kind: "body", bodyId: "b9" }]);
    expect(api.tangentEdges).toHaveBeenCalledWith("p1", edge("e1"), "f9");
    expect(useStore.getState().selection).toEqual([
      { kind: "body", bodyId: "b9" },
      ...chain,
    ]);
  });

  it("removes the chain when all of it is already picked", async () => {
    await pick([...chain, edge("e7")]);
    expect(useStore.getState().selection).toEqual([edge("e7")]);
  });

  it("leaves the pick to the input when the chain is off or no project is open", () => {
    expect(pick([], { tangentChain: false })).toBeUndefined();
    useStore.setState({ projectId: null });
    setFeatureParams({ tangentChain: true });
    expect(
      featureUI(type)!
        .create()
        .onPick(edge("e1"), useStore.getState(), setFeatureParams),
    ).toBeUndefined();
    useStore.setState({ projectId: "p1" });
    expect(
      featureUI(type)!
        .create()
        .onPick(
          { kind: "body", bodyId: "b1" },
          useStore.getState(),
          setFeatureParams,
        ),
    ).toBeUndefined();
    expect(api.tangentEdges).not.toHaveBeenCalled();
  });

  it("drops a chain that answers after the selection changed", async () => {
    const done = pick([]);
    useStore.setState({ selection: [edge("e9")] });
    await done;
    expect(useStore.getState().selection).toEqual([edge("e9")]);
  });

  it("drops a chain that answers after the chain was turned off", async () => {
    const done = pick([]);
    setFeatureParams({ tangentChain: false });
    await done;
    expect(useStore.getState().selection).toEqual([]);
  });

  it("shows a failed chain lookup as an error", async () => {
    vi.mocked(api.tangentEdges).mockRejectedValue(new Error("no chain"));
    await pick([]);
    expect(useStore.getState().setError).toHaveBeenCalledWith("no chain");
  });
});
