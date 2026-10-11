import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { expect, it } from "vitest";
import type { ExtensionFeature } from "@rockett/shared";
import {
  featureCommand,
  featureParams,
  setFeatureParams,
} from "../commands/featureCommand";
import { useStore } from "../store";
import {
  featureHandle,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import {
  num,
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

type Params = InputParams<{ width: number; note: string }>;

const current = () => {
  const state = useStore.getState();
  if (state.active?.id !== "design.feature")
    throw new Error("Missing extension command");
  return state.active.state.inputs;
};

it("binds an extension's width handle to its rendered input and current lifetime", async () => {
  let stale: FeatureFormProps<Params>["setParams"] | undefined;
  const handle: FeatureHandleDefinition<Params> = {
    param: "width",
    fallback: 2,
    signed: true,
    place: ({ params }) => ({
      kind: "arrow",
      origin: new THREE.Vector3(
        num(params, handle.param, handle.fallback),
        0,
        0,
      ),
      axis: new THREE.Vector3(1, 0, 0),
    }),
  };
  const ui: FeatureUI<ExtensionFeature<{ width: number }>, Params> = {
    type: "test.widthInputHandle",
    title: "Width input handle",
    icon: "test",
    group: "test",
    picks: [],
    initialParams: {},
    handle,
    Form: ({ params, setParams }) => {
      stale = setParams;
      return (
        <button
          onClick={() =>
            setParams({ width: num(params, handle.param, handle.fallback) + 5 })
          }
        >
          {num(params, handle.param, handle.fallback)}
        </button>
      );
    },
    build: (params) => ({
      id: "width-input-handle",
      type: "test.widthInputHandle",
      name: "",
      suppressed: false,
      version: 1,
      params: { width: num(params, handle.param, handle.fallback) },
    }),
    prefill: (feature) => ({ params: feature.params, selection: [] }),
  };
  const unregister = registerFeatureUI(ui);
  const baseline = useStore.getState();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = async () =>
    act(async () => root.render(current().renderForm(setFeatureParams)));
  const previewHandle = () =>
    featureHandle({
      dialog: ui.type,
      params: featureParams(useStore.getState()),
      selection: [],
      bodies: [],
      evaluation: null,
    });
  try {
    featureCommand.enter(ui.type);
    await render();
    expect(host.textContent).toBe("2");
    expect(previewHandle()).toMatchObject({
      param: "width",
      value: 2,
      origin: new THREE.Vector3(2, 0, 0),
    });
    await act(async () => host.querySelector("button")!.click());
    await render();
    expect(host.textContent).toBe("7");
    expect(current().build([])).toMatchObject({ params: { width: 7 } });
    expect(previewHandle()).toMatchObject({
      value: 7,
      origin: new THREE.Vector3(7, 0, 0),
    });
    const oldCallback = stale;
    if (!oldCallback) throw new Error("Missing typed setter");
    handle.fallback = 4;
    await act(async () => {
      useStore.getState().cancelDialog();
      featureCommand.enter(ui.type);
      oldCallback({ width: 99 });
    });
    await render();
    expect(host.textContent).toBe("4");
    expect(current().build([])).toMatchObject({ params: { width: 4 } });
    expect(previewHandle()).toMatchObject({
      value: 4,
      origin: new THREE.Vector3(4, 0, 0),
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useStore.getState().cancelDialog();
    useStore.setState(baseline, true);
    unregister();
  }
  expect(
    featureHandle({
      dialog: ui.type,
      params: {},
      selection: [],
      bodies: [],
      evaluation: null,
    }),
  ).toBeNull();
});
