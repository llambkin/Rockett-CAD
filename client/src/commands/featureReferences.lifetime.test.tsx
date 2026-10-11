import { featureParams } from "./featureCommand";
import { featureUI } from "../features/registry";
import {
  fillet,
  edgeRef,
  evaluate,
  server,
  host,
  wait,
  edit,
  button,
} from "../../test/helpers/refRepair";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { useStore } from "../store";
import { api } from "../api";
import { TIMING_MS } from "../tunables";

it.each(["OK", "Cancel"])(
  "%s after repair keeps its saved repair and commits or rolls back only the later preview",
  async (finish) => {
    const feature = { ...fillet, edges: [edgeRef("gone")] } as Feature;
    await edit(feature);
    vi.mocked(api.evaluate).mockImplementation(async () =>
      evaluate(server.saved),
    );
    await act(async () => button("Accept Edge 3, Body1").click());
    await wait(TIMING_MS.previewDebounce);
    const repaired = structuredClone(server.saved.features[0]);
    const input = host.querySelector('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(TIMING_MS.previewDebounce);
    expect(server.saved.features[0]).toEqual(repaired);
    expect(useStore.getState().document!.features[0]).toMatchObject({
      radius: 3,
      edges: [{ kind: "edge", bodyId: "b1", edgeName: "e3" }],
    });
    expect(server.previews.size).toBe(1);
    await act(async () => button(finish).click());
    await wait(0);
    expect(useStore.getState().active).toBeNull();
    expect(server.previews.size).toBe(0);
    expect(server.saved.features[0]).toEqual(
      finish === "OK" ? { ...repaired, radius: 3 } : repaired,
    );
    expect(server.labels()).toEqual(
      finish === "OK" ? ["Edit Fillet1", "Edit Fillet1"] : ["Edit Fillet1"],
    );
  },
);

it("a late repair never changes another project's dialog with the same feature ID", async () => {
  await edit(fillet);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.mocked(api.updateFeature).getMockImplementation()!;
  vi.mocked(api.updateFeature).mockImplementation(async (...args) => {
    await held;
    return write(...args);
  });
  await act(async () => button("Accept Edge 3, Body1").click());
  expect(useStore.getState().busy).toBe(true);
  const other = createEmptyDocument("other", "Other");
  other.features = [structuredClone(fillet)];
  other.timelinePosition = 1;
  const selection = [{ kind: "edge", bodyId: "b1", edgeName: "gone" }] as const;
  const params = {
    id: fillet.id,
    radius: 9,
    retained: { kind: "edge", bodyId: "b1", edgeName: "gone" },
  };
  await act(async () =>
    useStore.setState({
      projectId: other.id,
      document: other,
      evaluation: evaluate(other),
      active: {
        id: "design.feature",
        state: {
          type: "fillet",
          selectionBefore: [],
          editFeatureId: fillet.id,
          inputs: featureUI("fillet")!.create().withParams(params),
        },
      },
      selection: [...selection],
    }),
  );
  await act(async () => release());
  await wait(0);
  expect(useStore.getState().projectId).toBe(other.id);
  expect(useStore.getState().selection).toEqual(selection);
  expect(featureParams(useStore.getState())).toEqual(params);
  expect(api.evaluate).not.toHaveBeenCalled();
});

vi.mock("../api", async () => {
  const { repairApiMock } = await import("../features/featureUi.apiMocks");
  return repairApiMock();
});
