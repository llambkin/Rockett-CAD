import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { DialogFooter } from "../../src/components/form/DialogFooter";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { useStore } from "../../src/store";

async function mount(element: ReactElement) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const press = (target: EventTarget, key: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

const buttons = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].map((b) => [b.textContent, b.disabled]);

it("fires OK and Cancel from their buttons", async () => {
  const onOk = vi.fn();
  const onCancel = vi.fn();
  const { host, unmount } = await mount(
    <DialogFooter onOk={onOk} onCancel={onCancel} okLabel="Move" />,
  );
  expect(buttons(host)).toEqual([
    ["Move", false],
    ["Cancel", false],
  ]);
  const [ok, cancel] = host.querySelectorAll("button");
  await act(async () => ok!.click());
  await act(async () => cancel!.click());
  expect([onOk.mock.calls.length, onCancel.mock.calls.length]).toEqual([1, 1]);
  await unmount();
});

it("disables both buttons and both keys while pending", async () => {
  const onOk = vi.fn();
  const onCancel = vi.fn();
  const { host, unmount } = await mount(
    <div>
      <input />
      <DialogFooter onOk={onOk} onCancel={onCancel} pending />
    </div>,
  );
  expect(buttons(host)).toEqual([
    ["OK", true],
    ["Cancel", true],
  ]);
  await press(host.querySelector("input")!, "Enter");
  await press(host.querySelector("input")!, "Escape");
  expect([onOk, onCancel].map((f) => f.mock.calls.length)).toEqual([0, 0]);
  await unmount();
});

it("maps Enter and Escape inside the panel to OK and Cancel", async () => {
  const onOk = vi.fn();
  const onCancel = vi.fn();
  const { host, unmount } = await mount(
    <div>
      <input />
      <DialogFooter onOk={onOk} onCancel={onCancel} />
    </div>,
  );
  await press(host.querySelector("input")!, "Enter");
  await press(host.querySelector("input")!, "Escape");
  await press(document.body, "Enter");
  await press(document.body, "Escape");
  expect([onOk, onCancel].map((f) => f.mock.calls.length)).toEqual([1, 1]);
  await unmount();
});

it("honours okDisabled and renders the close-only variant", async () => {
  const onOk = vi.fn();
  const panel = await mount(
    <div>
      <input />
      <DialogFooter onOk={onOk} onCancel={() => {}} okDisabled />
    </div>,
  );
  expect(buttons(panel.host)[0]).toEqual(["OK", true]);
  await press(panel.host.querySelector("input")!, "Enter");
  expect(onOk).not.toHaveBeenCalled();
  await panel.unmount();

  const onClose = vi.fn();
  const closeOnly = await mount(
    <DialogFooter onCancel={onClose} cancelLabel="Done" escapeAnywhere />,
  );
  expect(buttons(closeOnly.host)).toEqual([["Done", false]]);
  expect(closeOnly.host.querySelector("button")!.className).toBe("btn");
  await press(document.body, "Escape");
  expect(onClose).toHaveBeenCalledOnce();
  await closeOnly.unmount();
});

it("gives FeatureDialog one Escape listener", async () => {
  const doc = createEmptyDocument("proj", "doc");
  useStore.setState({
    projectId: doc.id,
    document: doc,
    previewBaseline: null,
    mode: { name: "dialog", dialog: "extrude" },
  });
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { unmount } = await mount(<FeatureDialog />);
  const keydown = (spy: typeof add) =>
    spy.mock.calls.filter(([type]) => type === "keydown").length;
  expect(keydown(add) - keydown(remove)).toBe(1);
  await press(document.body, "Escape");
  expect(useStore.getState().mode).toEqual({ name: "idle" });
  add.mockRestore();
  remove.mockRestore();
  await unmount();
});

it("keeps dialog-actions inside DialogFooter", () => {
  const src = join(import.meta.dirname, "../../src");
  const hits = (readdirSync(src, { recursive: true }) as string[]).filter(
    (f) =>
      /\.(tsx?|css)$/.test(f) &&
      readFileSync(join(src, f), "utf8").includes("dialog-actions"),
  );
  expect(hits.sort()).toEqual([
    join("components", "form", "DialogFooter.tsx"),
    "theme.css",
  ]);
});
