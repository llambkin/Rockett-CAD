import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { ModelTree } from "../../src/components/ModelTree";
import { Timeline } from "../../src/components/Timeline";
import { ViewportContextMenu } from "../../src/components/ViewportContextMenu";
import { useStore } from "../../src/store";

vi.mock("../../src/api", () => ({ api: {} }));

const sketch = {
  id: "s1",
  type: "sketch",
  name: "Sketch1",
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
} as unknown as Feature;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  const doc = createEmptyDocument("p1", "Part");
  doc.features = [sketch];
  doc.timelinePosition = 1;
  useStore.setState({
    document: doc,
    evaluation: {
      bodies: [],
      planes: [],
      kernelMs: 0,
      featureStatuses: [],
      sketches: [],
    } as any,
    mode: { name: "idle" },
    selection: [],
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = (ui: ReactElement) => act(async () => root.render(ui));
const menu = () => host.querySelector(".context-menu");

async function rightClick(el: Element) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
  });
}

async function pointerDownOutside() {
  const outside = document.body.appendChild(document.createElement("div"));
  await act(async () => {
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  outside.remove();
}

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

async function expectClosesOutsideAndOnEscape(open: () => Promise<void>) {
  await open();
  expect(menu()).not.toBeNull();
  await act(async () => {
    menu()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(menu()).not.toBeNull();
  await pointerDownOutside();
  expect(menu()).toBeNull();
  await open();
  expect(menu()).not.toBeNull();
  await pressEscape();
  expect(menu()).toBeNull();
}

it("closes the timeline menu on a pointer down outside it and on Escape", async () => {
  await render(<Timeline />);
  await expectClosesOutsideAndOnEscape(() =>
    rightClick(host.querySelector(".tl-chip")!),
  );
});

it("closes the model tree menu on a pointer down outside it and on Escape", async () => {
  await render(<ModelTree />);
  const row = [...host.querySelectorAll(".tree-item")].find((el) =>
    el.textContent?.includes("Sketch1"),
  )!;
  await expectClosesOutsideAndOnEscape(() => rightClick(row));
});

it("closes the viewport menu on a pointer down outside it and on Escape", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button className="open" onClick={() => setOpen(true)} />
        {open && (
          <ViewportContextMenu
            menu={{
              x: 20,
              y: 30,
              sel: { kind: "edge", bodyId: "b1", edgeName: "e1" },
            }}
            onClose={() => setOpen(false)}
            isPlanarFace={() => false}
            alignToSketch={() => {}}
            onDimension={() => {}}
          />
        )}
      </>
    );
  }
  await render(<Harness />);
  await expectClosesOutsideAndOnEscape(async () => {
    await act(async () => host.querySelector<HTMLElement>(".open")!.click());
  });
});
