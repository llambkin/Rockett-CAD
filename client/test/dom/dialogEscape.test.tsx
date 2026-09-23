import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { useStore } from "../../src/store";
import { api } from "../../src/api";

vi.mock("../../src/api", () => ({ api: { replaceDocument: vi.fn() } }));

it("cancels the open dialog on Escape from a field", async () => {
  const baseline = createEmptyDocument("proj", "baseline");
  const previewed = { ...baseline, name: "previewed" };
  const evaluation = {
    bodies: [],
    planes: [],
    kernelMs: 0,
    featureStatuses: [],
    sketches: [],
  } as any;
  vi.mocked(api.replaceDocument).mockResolvedValue({
    document: baseline,
    evaluation,
  });
  useStore.setState({
    projectId: baseline.id,
    document: previewed,
    evaluation,
    previewBaseline: baseline,
    mode: { name: "dialog", dialog: "extrude" },
  });

  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<FeatureDialog />));
  const field = host.querySelector("input")!;
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

  expect(useStore.getState().mode).toEqual({ name: "idle" });
  expect(api.replaceDocument).toHaveBeenCalledWith(baseline.id, baseline);
  expect(useStore.getState().document).toBe(baseline);
  await act(async () => root.unmount());
});
