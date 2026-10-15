import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { useStore, type DialogType, type Selection } from "../../src/store";

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

async function open(dialog: DialogType, selection: Selection[]) {
  const addFeature = vi.fn(async (_feature: Feature) => {});
  useStore.setState({
    document: createEmptyDocument("proj", "doc"),
    selection,
    dialogParams: {},
    mode: { name: "dialog", dialog },
    addFeature,
  });
  const select = vi.spyOn(HTMLInputElement.prototype, "select");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<FeatureDialog />));
  await act(() => new Promise((r) => setTimeout(r, 0)));
  return {
    host,
    addFeature,
    selected: select.mock.contexts,
    close: async () => {
      select.mockRestore();
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it.each([
  {
    dialog: "extrude" as const,
    label: "Distance (mm)",
    key: "distance",
    pick: { kind: "profile", sketchId: "sk", profileId: "pr" } as const,
  },
  {
    dialog: "fillet" as const,
    label: "Radius (mm)",
    key: "radius",
    pick: { kind: "edge", bodyId: "b1", edgeName: "e1" } as const,
  },
])(
  "opens $dialog with $label focused and selected, and Enter commits it",
  async ({ dialog, label, key, pick }) => {
    const { host, addFeature, selected, close } = await open(dialog, [pick]);
    const input = [...host.querySelectorAll("label.field")]
      .find((l) => l.querySelector("span")?.textContent === label)!
      .querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(selected).toEqual([input]);

    await act(async () => {
      setValue.call(input, "25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(addFeature).toHaveBeenCalledOnce();
    expect(addFeature.mock.calls[0]![0]).toMatchObject({ [key]: 25 });
    await close();
  },
);

it("focuses nothing in a dialog without a number field", async () => {
  const { selected, close } = await open("sweep", []);
  expect(document.activeElement).toBe(document.body);
  expect(selected).toEqual([]);
  await close();
});
