import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { useStore } from "../../src/store";

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

it("keeps every transform value when its box is cleared", async () => {
  const doc = createEmptyDocument("proj", "doc");
  const canvas = {
    id: "canvas1",
    type: "referenceImage",
    name: "",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    assetId: "a1",
    fileName: "part.png",
    transform: { u: 3, v: -4, rotation: 30, scale: 0.25 },
    opacity: 0.6,
    visible: true,
    width: 100,
    height: 50,
  } as Feature;
  doc.features = [canvas];
  const updateFeature = vi.fn(async () => {});
  useStore.setState({
    projectId: doc.id,
    document: doc,
    mode: {
      name: "dialog",
      dialog: "referenceImage",
      editFeatureId: "canvas1",
    },
    updateFeature,
    updateFeaturePreview: vi.fn(async () => {}),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<FeatureDialog />));

  const labels = [...host.querySelectorAll("label.field")];
  const box = (text: string) =>
    labels
      .find((l) => l.querySelector("span")?.textContent === text)!
      .querySelector("input")!;
  for (const text of [
    "Scale (mm / pixel)",
    "Rotation (°)",
    "Position U (mm)",
    "Position V (mm)",
  ]) {
    const input = box(text);
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focus"));
      setValue.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const ok = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "OK",
  )!;
  await act(async () => ok.click());

  expect(updateFeature).toHaveBeenCalledWith("canvas1", {
    opacity: 0.6,
    transform: { u: 3, v: -4, rotation: 30, scale: 0.25 },
  });
  await act(async () => root.unmount());
});
