import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, expectTypeOf, it } from "vitest";
import type { ExtensionFeature } from "@rockett/shared";
import { featureCommand, setFeatureParams } from "../commands/featureCommand";
import { useStore } from "../store";
import { num } from "./inputs";
import {
  registerFeatureUI,
  featureUI,
  type FeatureUI,
  type FeatureFormProps,
  type InputParams,
} from "./registry";

export type BlockInputs = InputParams<{ width: number; note: string }>;
type BlockFeature = ExtensionFeature<{ width: number }>;

const captured: { setParams?: FeatureFormProps<BlockInputs>["setParams"] } = {};

const block: FeatureUI<BlockFeature, BlockInputs> = {
  type: "test.typedInputs",
  icon: "block",
  title: "Typed block",
  group: "test",
  picks: [],
  initialParams: { width: 2, note: "new" },
  Form: ({ params, setParams }: FeatureFormProps<BlockInputs>) => {
    captured.setParams = setParams;
    return createElement("button", {
      onClick: () => setParams({ width: 7, note: "edited" }),
      children: `${params.note}:${params.width}`,
    });
  },
  build: (params) => ({
    id: params.id ?? "block-input",
    type: "test.typedInputs",
    name: params.name ?? "",
    suppressed: false,
    version: 1,
    params: { width: num(params, "width", 2) },
  }),
  prefill: (feature) => ({
    params: {
      id: feature.id,
      name: feature.name,
      width: feature.params.width,
      note: "reopened",
    },
    selection: [],
  }),
  onPick: (_pick, _store, params, setParams) => {
    setParams({ width: num(params, "width", 2) + 1, note: "picked" });
    return Promise.resolve();
  },
};

it("retains extension-specific typed inputs through form, pick, build and prefill", async () => {
  const dispose = registerFeatureUI(block);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    featureCommand.enter(block.type);
    const state = useStore.getState();
    if (state.active?.id !== "design.feature")
      throw new Error("Missing extension command");
    const inputs = state.active.state.inputs;
    await act(async () => root.render(inputs.renderForm(setFeatureParams)));
    expect(host.textContent).toBe("new:2");
    await act(async () => host.querySelector("button")!.click());
    const picked = useStore.getState();
    if (picked.active?.id !== "design.feature")
      throw new Error("Missing extension command");
    expect(picked.active.state.inputs.params).toMatchObject({
      width: 7,
      note: "edited",
    });
    await picked.active.state.inputs.onPick(
      { kind: "body", bodyId: "synthetic-body" },
      picked,
      setFeatureParams,
    );
    const after = useStore.getState();
    if (after.active?.id !== "design.feature")
      throw new Error("Missing extension command");
    expect(after.active.state.inputs.params).toMatchObject({
      width: 8,
      note: "picked",
    });
    const built = after.active.state.inputs.build([]);
    expect(built).toEqual({
      id: "block-input",
      type: block.type,
      name: "",
      suppressed: false,
      version: 1,
      params: { width: 8 },
    });
    if (!built || "error" in built) throw new Error("Extension did not build");
    const reopened = featureUI(block.type)!.prefill!(built);
    expect(reopened.inputs.params).toEqual({
      id: "block-input",
      name: "",
      width: 8,
      note: "reopened",
    });
    expect(reopened.inputs.build(reopened.selection)).toEqual(built);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useStore.getState().cancelDialog();
    dispose();
  }
});

it("keeps the custom parameter type at form, build and pick declarations", () => {
  expectTypeOf<
    Parameters<NonNullable<typeof block.build>>[0]
  >().toEqualTypeOf<BlockInputs>();
  expectTypeOf<
    Parameters<NonNullable<typeof block.onPick>>[2]
  >().toEqualTypeOf<BlockInputs>();
  expectTypeOf<
    Parameters<FeatureFormProps<BlockInputs>["setParams"]>[0]
  >().toEqualTypeOf<Partial<BlockInputs>>();
  expectTypeOf<{ width: boolean }>().not.toExtend<BlockInputs>();
  expectTypeOf<{ typoWidth: number }>().not.toExtend<BlockInputs>();
  expectTypeOf<{ width: string }>().toExtend<BlockInputs>();
  expectTypeOf<{ note: string }>().not.toExtend<
    Parameters<typeof setFeatureParams>[0]
  >();
});

it("refuses an old typed form callback after the same extension reopens", async () => {
  const dispose = registerFeatureUI(block);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    featureCommand.enter(block.type);
    const state = useStore.getState();
    if (state.active?.id !== "design.feature")
      throw new Error("Missing extension command");
    const inputs = state.active.state.inputs;
    await act(async () => root.render(inputs.renderForm(setFeatureParams)));
    const stale = captured.setParams;
    if (!stale) throw new Error("Missing typed callback");
    await act(async () => {
      stale({ note: "same lifetime" });
      stale({ width: 5 });
    });
    const edited = useStore.getState().active;
    if (edited?.id !== "design.feature")
      throw new Error("Missing extension command");
    expect(edited.state.inputs.params).toEqual({
      width: 5,
      note: "same lifetime",
    });
    await act(async () => {
      useStore.getState().cancelDialog();
      featureCommand.enter(block.type);
      stale({ width: 42 });
    });
    const current = useStore.getState().active;
    if (current?.id !== "design.feature")
      throw new Error("Missing extension command");
    expect(current.state.inputs.params).toEqual({ width: 2, note: "new" });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useStore.getState().cancelDialog();
    dispose();
  }
});
