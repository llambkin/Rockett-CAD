import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  emptyView,
  type CadDocument,
  type TreeGroup,
} from "@rockett/shared";
import { api } from "../../src/api";
import { ModelTree } from "../../src/components/ModelTree";
import { useStore } from "../../src/store";

vi.mock("../../src/api", () => ({
  api: {
    updateGroups: vi.fn(),
    putView: vi.fn(async (_id: string, view: unknown) => view),
    replaceDocument: vi.fn(),
  },
}));

const evaluation = {
  bodies: [1, 2, 3].map((n) => ({
    bodyId: `b${n}`,
    name: `Body${n}`,
    visible: true,
  })),
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
} as any;

let host: HTMLElement;
let root: Root;

function withGroups(groups: TreeGroup[]): CadDocument {
  return { ...useStore.getState().document!, groups };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(api.updateGroups).mockImplementation(async (_id, groups) => ({
    document: withGroups(groups),
    evaluation,
  }));
  vi.mocked(api.replaceDocument).mockImplementation(async (_id, document) => ({
    document,
    evaluation,
  }));
  useStore.setState({
    projectId: "p1",
    document: createEmptyDocument("p1", "Part"),
    evaluation,
    view: emptyView(),
    mode: { name: "idle" },
    selection: [],
    undoStack: [],
    redoStack: [],
    busy: false,
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<ModelTree />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const row = (text: string) =>
  [...host.querySelectorAll<HTMLElement>(".tree-item")].find((el) =>
    el.textContent?.trim().endsWith(text),
  );
const groups = () => useStore.getState().document!.groups;

async function click(el: Element, mods: MouseEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }),
    );
  });
}

async function menu(el: Element, label: string) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const item = [...host.querySelectorAll<HTMLElement>(".context-menu button")];
  const found = item.find((b) => b.textContent === label);
  expect(found, item.map((b) => b.textContent).join(", ")).toBeDefined();
  await act(async () => found!.click());
}

async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

async function selectTwoBodies() {
  await click(row("Body1")!);
  await click(row("Body2")!, { ctrlKey: true });
}

it("creates a group with Ctrl+G, renames it and nests its members", async () => {
  await selectTwoBodies();
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true }),
    );
  });
  expect(groups()).toEqual([
    {
      id: expect.any(String),
      name: "Group 1",
      kind: "body",
      members: ["b1", "b2"],
    },
  ]);
  const input = host.querySelector<HTMLInputElement>(".tree-rename")!;
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Group 1");
  await type(input, "Brackets");
  expect(groups()[0]!.name).toBe("Brackets");
  const header = row("Brackets")!;
  const nested = header.nextElementSibling!;
  expect(nested.classList.contains("tree-children")).toBe(true);
  expect(nested.textContent).toContain("Body1");
  expect(nested.textContent).toContain("Body2");
  expect(nested.textContent).not.toContain("Body3");
  expect(useStore.getState().undoStack).toHaveLength(2);
});

it("names a group from the multi-selection menu after the existing ones", async () => {
  useStore.setState({
    document: withGroups([
      { id: "g1", name: "Group 1", kind: "body", members: ["b3"] },
    ]),
  });
  await selectTwoBodies();
  await menu(row("Body2")!, "Group");
  expect(groups().map((g) => [g.name, g.members])).toEqual([
    ["Group 1", ["b3"]],
    ["Group 2", ["b1", "b2"]],
  ]);
});

it("collapses a group and acts on its members from the group menu", async () => {
  useStore.setState({
    document: withGroups([
      { id: "g1", name: "Parts", kind: "body", members: ["b1", "b2"] },
    ]),
  });
  await act(async () => {});
  await click(row("Parts")!);
  expect(row("Body1")).toBeUndefined();
  expect(row("Body3")).toBeDefined();
  await click(row("Parts")!);
  expect(row("Body1")).toBeDefined();

  await menu(row("Parts")!, "Select members");
  expect(useStore.getState().selection).toEqual([
    { kind: "body", bodyId: "b1" },
    { kind: "body", bodyId: "b2" },
  ]);
  await menu(row("Parts")!, "Show / Hide all");
  expect(vi.mocked(api.putView).mock.calls).toEqual([
    ["p1", { version: 1, hidden: { bodies: ["b1", "b2"], features: [] } }],
  ]);
});

it("ungroups from the group menu and undo brings the group back", async () => {
  await selectTwoBodies();
  await menu(row("Body1")!, "Group");
  await act(async () =>
    host
      .querySelector(".tree-rename")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  await menu(row("Group 1")!, "Ungroup");
  expect(groups()).toEqual([]);
  expect(row("Group 1")).toBeUndefined();
  await act(async () => useStore.getState().undo());
  expect(groups().map((g) => g.name)).toEqual(["Group 1"]);
  expect(row("Group 1")).toBeDefined();
});

it("shows only the members that exist and keeps an empty group", async () => {
  useStore.setState({
    document: withGroups([
      { id: "g1", name: "Parts", kind: "body", members: ["b1", "gone"] },
      { id: "g2", name: "Empty", kind: "body", members: [] },
    ]),
  });
  await act(async () => {});
  expect(row("Parts")!.nextElementSibling!.textContent).toBe("👁Body1");
  expect(row("Empty")).toBeDefined();
});
