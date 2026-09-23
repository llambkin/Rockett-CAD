import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { App } from "../../src/App";
import { api } from "../../src/api";
import { ModelTree } from "../../src/components/ModelTree";
import { Timeline } from "../../src/components/Timeline";
import { ViewportContextMenu } from "../../src/components/ViewportContextMenu";
import { useStore } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";

vi.mock("../../src/api", () => ({
  api: {
    health: vi.fn(() => new Promise(() => {})),
    listProjects: vi.fn(),
    listFolders: vi.fn(async () => ({ folders: [], placement: {} })),
    duplicateProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

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
const labels = () =>
  [...menu()!.querySelectorAll("button")].map((b) => b.textContent);
const treeRow = (text: string) =>
  [...host.querySelectorAll(".tree-item")].find((el) =>
    el.textContent?.includes(text),
  )!;

async function choose(label: string) {
  const item = [...menu()!.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  )!;
  await act(async () => item.click());
}

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

it("duplicates a project from its row menu and confirms a delete", async () => {
  useStore.setState({ projectId: null });
  vi.mocked(api.listProjects).mockResolvedValue([
    {
      id: "p1",
      name: "Plate",
      featureCount: 2,
      createdAt: "2026-09-23T00:00:00Z",
      modifiedAt: "2026-09-23T00:00:00Z",
    },
  ]);
  vi.mocked(api.duplicateProject).mockResolvedValue({} as any);
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  await render(<App />);
  await act(async () => {});

  await rightClick(host.querySelector(".project-row")!);
  expect(labels()).toEqual([
    "Open",
    "Rename",
    "Duplicate",
    "Download",
    "Move to…",
    "Delete",
  ]);
  await choose("Duplicate");
  expect(api.duplicateProject).toHaveBeenCalledWith("p1");
  expect(menu()).toBeNull();

  await rightClick(host.querySelector(".project-row")!);
  await choose("Delete");
  expect(confirm).toHaveBeenCalled();
  expect(api.deleteProject).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("fits the view from the empty viewport menu", async () => {
  const zoomToFit = vi.fn();
  viewportHandle.current = { zoomToFit, projection: "perspective" } as any;
  await render(
    <ViewportContextMenu
      menu={{ x: 20, y: 30, sel: null }}
      onClose={() => {}}
      isPlanarFace={() => false}
      alignToSketch={() => {}}
      onDimension={() => {}}
    />,
  );
  expect(labels()).toEqual([
    "Fit",
    "Front",
    "Back",
    "Left",
    "Right",
    "Top",
    "Bottom",
    "Iso",
    "Orthographic",
  ]);
  await choose("Fit");
  expect(zoomToFit).toHaveBeenCalledOnce();
  viewportHandle.current = null;
});

it("starts a sketch on an origin plane from its tree menu, only when idle", async () => {
  const startSketchOnPlane = vi.fn(async () => {});
  useStore.setState({ startSketchOnPlane });
  await render(<ModelTree />);
  await rightClick(treeRow("XY Plane"));
  await choose("Create sketch");
  expect(startSketchOnPlane).toHaveBeenCalledWith({
    kind: "origin",
    plane: "XY",
  });

  await act(async () =>
    useStore.setState({
      mode: {
        name: "sketch",
        sketchId: "s1",
        tool: "line",
        constructionMode: false,
      },
    }),
  );
  await rightClick(treeRow("XZ Plane"));
  expect(menu()).toBeNull();
});

it("deletes a construction plane and hides a canvas from their tree menus", async () => {
  const deleteFeature = vi.fn(async () => {});
  const updateFeature = vi.fn(async () => {});
  useStore.setState({ deleteFeature, updateFeature });
  const doc = useStore.getState().document!;
  useStore.setState({
    document: {
      ...doc,
      features: [
        ...doc.features,
        {
          id: "c1",
          type: "constructionPlane",
          name: "Plane1",
          method: { kind: "offset", distance: 5 },
        },
        { id: "r1", type: "referenceImage", name: "Canvas1", visible: true },
      ] as unknown as Feature[],
    },
  });
  await render(<ModelTree />);

  await rightClick(treeRow("Plane1"));
  expect(labels()).toEqual(["Create sketch", "Edit", "Show / Hide", "Delete"]);
  await choose("Delete");
  expect(deleteFeature).toHaveBeenCalledWith("c1");

  await rightClick(treeRow("Canvas1"));
  expect(labels()).toEqual(["Edit", "Show / Hide", "Delete"]);
  await choose("Show / Hide");
  expect(updateFeature).toHaveBeenCalledWith("r1", { visible: false });
});

it("names the line dimension item Length and angle and offers it only while sketching", async () => {
  const onDimension = vi.fn();
  const draft = {
    ...sketch,
    entities: [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 10, y: 0 },
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "o1", kind: "circle", center: "a", radius: 3 },
    ],
  } as any;
  const entityMenu = (entityId: string) => (
    <ViewportContextMenu
      menu={{
        x: 20,
        y: 30,
        sel: { kind: "sketchEntity", sketchId: "s1", entityId },
      }}
      onClose={() => {}}
      isPlanarFace={() => false}
      alignToSketch={() => {}}
      onDimension={onDimension}
    />
  );
  useStore.setState({
    mode: {
      name: "sketch",
      sketchId: "s1",
      tool: "select",
      constructionMode: false,
    },
    draftSketch: draft,
  });

  await render(entityMenu("l1"));
  expect(labels()).toEqual([
    "Delete",
    "Toggle construction",
    "Length and angle…",
  ]);
  await choose("Length and angle…");
  expect(onDimension).toHaveBeenCalledWith("l1", { clientX: 20, clientY: 30 });

  await render(entityMenu("o1"));
  expect(labels()).toContain("Dimension…");

  useStore.setState({ mode: { name: "idle" }, draftSketch: null });
  await render(entityMenu("l1"));
  expect(labels()).toEqual(["Toggle construction", "Edit sketch"]);
});
