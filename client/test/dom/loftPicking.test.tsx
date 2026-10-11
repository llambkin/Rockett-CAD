import { act } from "react";
import { expect, it, vi } from "vitest";
import { api } from "../../src/api";
import { runCommand } from "../../src/commands/registry";
import { useStore } from "../../src/store";
import {
  clickAt,
  open,
  topOf1,
  topOf2,
} from "../../src/features/pickFields.scene";
import { wait } from "../helpers/boxScene";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
}));
vi.mock("../../src/three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));
vi.mock("../../src/api", async () => {
  const { pickApiMock } = await import("../../src/features/featureUi.apiMocks");
  return pickApiMock();
});

it("submits planar faces selected with plain viewport clicks in their picked order", async () => {
  const host = await open(null);
  await act(async () => runCommand("design.loft"));
  await clickAt(topOf2);
  await clickAt(topOf1);
  const sections = [
    { kind: "face", bodyId: "b2", faceName: "top" },
    { kind: "face", bodyId: "b1", faceName: "top" },
  ];
  expect(useStore.getState().selection).toEqual(sections);
  await clickAt(topOf1);
  expect(useStore.getState().selection).toEqual([sections[0]]);
  await clickAt(topOf1);
  await wait(400);
  const ok = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "OK",
  )!;
  expect(ok.disabled).toBe(false);
  await act(async () => ok.click());
  expect(api.addFeature).toHaveBeenCalledWith(
    "proj",
    expect.objectContaining({
      type: "loft",
      sections,
    }),
    expect.any(String),
    expect.any(Number),
  );
});
