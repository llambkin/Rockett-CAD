import { act } from "react";
import { expect, it, vi } from "vitest";
import { emptyView, type FilletFeature } from "@rockett/shared";
import { api } from "../api";
import { openFeatureEditor } from "../components/Timeline";
import { useStore } from "../store";
import { mountScene, wait } from "../../test/helpers/boxScene";
import { server, scene } from "./pickFields.scene";

it("a consumed edge shows its number as soon as loadPreviewBase resolves, with no other store change", async () => {
  const fillet: FilletFeature = {
    id: "f1",
    type: "fillet",
    filletType: "equalDistance",
    name: "Fillet1",
    suppressed: false,
    edges: [{ kind: "edge", bodyId: "b1", edgeName: "z00" }],
    radius: 1,
    tangentChain: false,
  };
  server.features.push(structuredClone(fillet));
  server.timelinePosition = 3;
  const consumed = scene();
  consumed.bodies[0]!.edges = consumed.bodies[0]!.edges.slice(1);
  let land!: (evaluation: ReturnType<typeof scene>) => void;
  vi.mocked(api.evaluate).mockImplementationOnce(
    () => new Promise((resolve) => (land = resolve)),
  );
  const host = await mountScene({
    projectId: server.id,
    document: structuredClone(server),
    evaluation: consumed,
    view: emptyView(),
    selection: [],
  });
  await act(async () => openFeatureEditor(structuredClone(fillet)));
  await wait(0);
  const rows = () =>
    [
      ...host.querySelectorAll(
        '[role="list"][aria-label="Edges"] [role="listitem"] span',
      ),
    ].map((el) => el.textContent);
  expect(rows()).toEqual(["Edge, Body1"]);
  expect(api.evaluate).toHaveBeenCalledWith(server.id, 2);
  const before = useStore.getState();
  await act(async () => land(scene()));
  expect(useStore.getState()).toBe(before);
  expect(rows()).toEqual(["Edge 1, Body1"]);
});

vi.mock("../api", async () => {
  const { pickApiMock } = await import("./featureUi.apiMocks");
  return pickApiMock();
});

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../../test/helpers/fakeRenderer"))
    .FakeWebGLRenderer,
}));
vi.mock("../three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));
