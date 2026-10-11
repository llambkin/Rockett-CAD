import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeatureDialog } from "../components/FeatureDialog";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../api";
import { useStore } from "../store";
import { featureCommand, setFeatureParams } from "../commands/featureCommand";
import "./fillet";
import type { ExtrudeParams } from "./extrude";
import { chamfer, type ChamferParams } from "./chamfer";
import { createFeatureInputs } from "./registry";
import type { ChamferFeature } from "@rockett/shared";

const original: ChamferFeature = {
  id: "chamfer-input",
  type: "chamfer",
  chamferType: "equalDistance",
  name: "Chamfer",
  suppressed: false,
  distance: 2.5,
  tangentChain: false,
  edges: [{ kind: "edge", bodyId: "body-input", edgeName: "edge-input" }],
};

describe("typed Chamfer inputs", () => {
  it.each([
    ["equalDistance", ["Type", "Distance (mm)"]],
    ["twoDistances", ["Type", "Distance 1 (mm)", "Distance 2 (mm)", "Flip"]],
    ["distanceAngle", ["Type", "Distance (mm)", "Angle (°)", "Flip"]],
  ] as const)("shows the %s fields", (chamferType, labels) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createFeatureInputs(chamfer, { chamferType }).renderForm(() => {}),
    );
    expect(
      [...host.querySelectorAll("label.field > span")]
        .map((span) => span.textContent)
        .filter((text) => text !== "Tangent chain"),
    ).toEqual(labels);
  });
  it("switching a prefilled type builds only the new type's fields", () => {
    const two: ChamferFeature = {
      ...original,
      chamferType: "twoDistances",
      distance2: 4,
      flip: true,
    };
    const { params, selection } = chamfer.prefill!(two);
    expect(createFeatureInputs(chamfer, params).build(selection)).toEqual(two);
    expect(
      createFeatureInputs(chamfer, {
        ...params,
        chamferType: "equalDistance",
      }).build(selection),
    ).toEqual(original);
    expect(
      createFeatureInputs(chamfer, {
        ...params,
        chamferType: "distanceAngle",
      }).build(selection),
    ).toEqual({
      ...original,
      chamferType: "distanceAngle",
      angle: 45,
      flip: true,
    });
  });
  it("refuses an input owner from a different feature", () => {
    featureCommand.enter("chamfer");
    const before = useStore.getState().active;
    featureCommand.enter("fillet", {
      inputs: createFeatureInputs(chamfer, {}),
      selection: [],
    });
    expect(useStore.getState().active).toBe(before);
  });
  it("uses the same prefilled params for its form, build and immutable updates", async () => {
    const { params, selection } = chamfer.prefill!(original);
    const inputs = createFeatureInputs(chamfer, params);
    expect(inputs.params).toBe(params);
    expect(inputs.build(selection)).toEqual(original);
    expect(renderToStaticMarkup(inputs.renderForm(() => {}))).toContain("2.5");
    const changed = inputs.withParams({ distance: 4, tangentChain: true });
    expect(changed.params).not.toBe(params);
    expect(inputs.params.distance).toBe(2.5);
    expect(changed.build(selection)).toEqual({
      ...original,
      distance: 4,
      tangentChain: true,
    });
    expect(changed.picks()).toEqual(chamfer.picks);
    featureCommand.enter("chamfer", { inputs, selection });
    expect(useStore.getState().active?.state).toMatchObject({ inputs });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(FeatureDialog)));
      expect(
        host.querySelector<HTMLInputElement>('input[type="text"]')?.value,
      ).toBe("2.5");
      await act(async () => setFeatureParams({ distance: 4 }));
      expect(
        host.querySelector<HTMLInputElement>('input[type="text"]')?.value,
      ).toBe("4");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it("retains numeric defaults and explicit zero in the existing form and build", () => {
    const defaults = createFeatureInputs(chamfer, {});
    const zero = createFeatureInputs(chamfer, { distance: 0 });
    expect(defaults.build(original.edges)).toMatchObject({ distance: 1 });
    expect(zero.build(original.edges)).toMatchObject({ distance: 0 });
    expect(renderToStaticMarkup(defaults.renderForm(() => {}))).toContain(
      'value="1"',
    );
    expect(renderToStaticMarkup(zero.renderForm(() => {}))).toContain(
      'value="0"',
    );
  });
  it("rejects unrelated fields and invalid value types at the declaration", () => {
    expectTypeOf<{
      misspelledDistance: number;
    }>().not.toExtend<ChamferParams>();
    expectTypeOf<{ distance: boolean }>().not.toExtend<ChamferParams>();
    expectTypeOf<{ tangentChain: string }>().not.toExtend<ChamferParams>();
    expectTypeOf<{ distance: string }>().toExtend<ChamferParams>();
    expectTypeOf<{}>().toExtend<ChamferParams>();
    expectTypeOf<{
      distance2: string;
      startOffset: string;
    }>().toExtend<ExtrudeParams>();
  });
  it("keeps incomplete expression input without inventing an evaluator", () => {
    const inputs = createFeatureInputs(chamfer, {
      distance: "width /",
      tangentChain: false,
    });
    expect(inputs.params.distance).toBe("width /");
    expect(inputs.build([])).toEqual({
      error: "Select at least one edge, face or feature",
    });
  });
});

describe("Chamfer pending pick lifetime", () => {
  it("keeps a chain reply across a parameter edit", async () => {
    let complete!: (
      value: Awaited<ReturnType<typeof api.tangentEdges>>,
    ) => void;
    const response = new Promise<Awaited<ReturnType<typeof api.tangentEdges>>>(
      (resolve) => {
        complete = resolve;
      },
    );
    const spy = vi.spyOn(api, "tangentEdges").mockReturnValue(response);
    useStore.setState({
      projectId: "typed-input-project",
      selection: [],
      busy: false,
    });
    featureCommand.enter("chamfer");
    const pick = original.edges[0]!;
    const state = useStore.getState();
    if (state.active?.id !== "design.feature")
      throw new Error("Missing Chamfer command");
    const request = state.active.state.inputs.onPick(
      pick,
      state,
      setFeatureParams,
    );
    setFeatureParams({ distance: 4 });
    complete({ edges: [pick] });
    await request;
    expect(useStore.getState().selection).toEqual([pick]);
    spy.mockRestore();
  });
  it("drops a chain reply after cancel and reopen of the same feature", async () => {
    let complete!: (
      value: Awaited<ReturnType<typeof api.tangentEdges>>,
    ) => void;
    const response = new Promise<Awaited<ReturnType<typeof api.tangentEdges>>>(
      (resolve) => {
        complete = resolve;
      },
    );
    const spy = vi.spyOn(api, "tangentEdges").mockReturnValue(response);
    useStore.setState({
      projectId: "typed-input-project",
      selection: [],
      busy: false,
    });
    featureCommand.enter("chamfer");
    const pick = original.edges[0]!;
    const state = useStore.getState();
    if (state.active?.id !== "design.feature")
      throw new Error("Missing Chamfer command");
    const request = state.active.state.inputs.onPick(
      pick,
      state,
      setFeatureParams,
    );
    useStore.getState().cancelDialog();
    featureCommand.enter("chamfer", {
      inputs: createFeatureInputs(chamfer, {}),
      selection: state.selection,
    });
    complete({ edges: [pick] });
    await request;
    expect(useStore.getState().selection).toEqual([]);
    spy.mockRestore();
  });
  it("drops a failed chain reply from a cancelled feature lifetime", async () => {
    let fail!: (error: Error) => void;
    const response = new Promise<Awaited<ReturnType<typeof api.tangentEdges>>>(
      (_resolve, reject) => {
        fail = reject;
      },
    );
    const spy = vi.spyOn(api, "tangentEdges").mockReturnValue(response);
    useStore.setState({
      projectId: "typed-input-project",
      selection: [],
      busy: false,
      error: null,
    });
    featureCommand.enter("chamfer");
    const state = useStore.getState();
    if (state.active?.id !== "design.feature")
      throw new Error("Missing Chamfer command");
    const request = state.active.state.inputs.onPick(
      original.edges[0]!,
      state,
      setFeatureParams,
    );
    useStore.getState().cancelDialog();
    featureCommand.enter("chamfer", {
      inputs: createFeatureInputs(chamfer, {}),
      selection: state.selection,
    });
    fail(new Error("old feature failed"));
    await request;
    expect(useStore.getState().error).toBeNull();
    spy.mockRestore();
  });
});
