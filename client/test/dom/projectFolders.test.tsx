import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Folder, ProjectSummary } from "@rockett/shared";
import { App } from "../../src/App";
import { useStore } from "../../src/store";

const summary = (id: string, name: string): ProjectSummary => ({
  id,
  name,
  featureCount: 3,
  createdAt: "2026-09-23T00:00:00Z",
  modifiedAt: "2026-09-23T00:00:00Z",
});

let projects: ProjectSummary[];
let folders: Folder[];
let placement: Record<string, string>;
let host: HTMLElement;
let root: Root;
const openProject = vi.fn(async (_id: string) => {});

const itemsIn = (id: string) =>
  folders.filter((f) => f.parentId === id).length +
  Object.values(placement).filter((f) => f === id).length;

const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
  const body = init.body ? JSON.parse(init.body as string) : undefined;
  const folderUrl = /^\/api\/folders\/([^/]+)$/.exec(url)?.[1];
  const placeUrl = /^\/api\/projects\/([^/]+)\/folder$/.exec(url)?.[1];
  const folder = folders.find((f) => f.id === folderUrl);
  if (url === "/api/health") return new Promise<Response>(() => {});
  if (url === "/api/projects" && init.method === "GET")
    return Response.json(projects);
  if (url === "/api/projects" && init.method === "POST")
    return Response.json({ document: { id: "p9" } });
  if (url === "/api/folders" && init.method === "GET")
    return Response.json({ folders, placement });
  if (url === "/api/folders" && init.method === "POST") {
    const created = {
      id: `f${folders.length + 1}`,
      name: body.name,
      parentId: body.parentId ?? null,
    };
    folders.push(created);
    return Response.json({ folder: created });
  }
  if (folder && init.method === "PATCH") {
    Object.assign(folder, body);
    return Response.json({ folder });
  }
  if (folder && init.method === "DELETE") {
    if (itemsIn(folder.id) > 0)
      return Response.json(
        {
          error: `Folder "${folder.name}" is not empty. Move or delete its ${itemsIn(folder.id)} items first.`,
          code: "conflict",
        },
        { status: 409 },
      );
    folders = folders.filter((f) => f !== folder);
    return Response.json({ ok: true });
  }
  if (placeUrl && init.method === "PUT") {
    if (body.folderId) placement[placeUrl] = body.folderId;
    else delete placement[placeUrl];
    return Response.json({ ok: true });
  }
  return Response.json(
    { error: "Unexpected", code: "internal" },
    {
      status: 500,
    },
  );
});

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(async () => {});
}

beforeEach(() => {
  projects = [summary("p1", "Gearbox lid"), summary("p2", "Motor mount")];
  folders = [];
  placement = {};
  vi.stubGlobal("fetch", fetchStub);
  useStore.setState({ projectId: null, error: null, openProject });
  host = document.body.appendChild(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  fetchStub.mockClear();
  openProject.mockClear();
  vi.unstubAllGlobals();
});

const rowNames = () =>
  [...host.querySelectorAll(".project-row .project-open b")].map(
    (b) => b.textContent,
  );
const row = (name: string) =>
  [...host.querySelectorAll<HTMLElement>(".project-row")].find(
    (r) => r.querySelector(".project-open b")?.textContent === name,
  )!;
const button = (label: string, within: ParentNode = host) =>
  [...within.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.textContent === label,
  )!;
const crumbs = () =>
  [...host.querySelectorAll(".breadcrumb > *")].map((c) => c.textContent);
const click = (el: HTMLElement) => act(async () => el.click());

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

async function menu(el: Element, label: string) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  await click(button(label, host.querySelector(".context-menu")!));
}

const fire = (el: Element, name: string) =>
  act(async () => {
    const e = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: new DataTransfer() });
    el.dispatchEvent(e);
  });

async function drag(from: Element, to: Element) {
  await fire(from, "dragstart");
  await fire(to, "dragenter");
  await fire(to, "dragover");
  await fire(to, "drop");
  await fire(from, "dragend");
}

it("creates a folder, moves a project into it, opens it and returns by the breadcrumb", async () => {
  await renderAt("/");
  expect(crumbs()).toEqual(["Projects"]);

  await click(button("New folder"));
  const name = host.querySelector<HTMLInputElement>(
    'input[aria-label="Folder name"]',
  )!;
  await type(name, "Brackets");
  expect(folders).toEqual([{ id: "f1", name: "Brackets", parentId: null }]);
  expect(rowNames()).toEqual(["Brackets", "Gearbox lid", "Motor mount"]);
  expect(row("Brackets").textContent).toContain("0 items");

  await menu(row("Gearbox lid"), "Move to…");
  const dialog = host.querySelector(".dialog-panel")!;
  expect(dialog.querySelector(".dialog-title")?.textContent).toContain(
    'Move "Gearbox lid"',
  );
  await click(
    [...dialog.querySelectorAll<HTMLElement>(".tree-item")].find(
      (t) => t.textContent === "Brackets",
    )!,
  );
  await click(button("Move", dialog));
  expect(placement).toEqual({ p1: "f1" });
  expect(host.querySelector(".dialog-panel")).toBeNull();
  expect(rowNames()).toEqual(["Brackets", "Motor mount"]);
  expect(row("Brackets").textContent).toContain("1 item");

  await click(row("Brackets").querySelector(".project-open")!);
  expect(window.location.pathname).toBe("/folders/f1");
  expect(crumbs()).toEqual(["Projects", "Brackets"]);
  expect(rowNames()).toEqual(["Gearbox lid"]);

  await click(button("Projects", host.querySelector(".breadcrumb")!));
  expect(window.location.pathname).toBe("/");
  expect(rowNames()).toEqual(["Brackets", "Motor mount"]);
});

it("drags a project onto a folder and a folder back onto the root crumb", async () => {
  folders = [
    { id: "f1", name: "Brackets", parentId: null },
    { id: "f2", name: "Steel", parentId: null },
  ];
  await renderAt("/");
  await drag(row("Motor mount"), row("Steel").querySelector(".project-open")!);
  expect(placement).toEqual({ p2: "f2" });

  await drag(row("Steel"), row("Brackets").querySelector(".project-open")!);
  expect(folders[1]).toEqual({ id: "f2", name: "Steel", parentId: "f1" });

  await click(row("Brackets").querySelector(".project-open")!);
  await drag(
    row("Steel"),
    button("Projects", host.querySelector(".breadcrumb")!),
  );
  expect(folders[1]!.parentId).toBeNull();
});

it("dims the current folder, the moved folder and its descendants in Move to", async () => {
  folders = [
    { id: "f1", name: "Brackets", parentId: null },
    { id: "f2", name: "Steel", parentId: "f1" },
    { id: "f3", name: "Plates", parentId: "f2" },
    { id: "f4", name: "Bolts", parentId: "f3" },
    { id: "f5", name: "Enclosures", parentId: null },
  ];
  await renderAt("/folders/f2");
  expect(crumbs()).toEqual(["Projects", "Brackets", "Steel"]);
  await menu(row("Plates"), "Move to…");
  const items = [...host.querySelectorAll(".dialog-panel .tree-item")];
  expect(
    items.map((t) => [t.textContent, t.classList.contains("dimmed")]),
  ).toEqual([
    ["Projects", false],
    ["Brackets", false],
    ["Steel (here)", true],
    ["Plates (this folder)", true],
    ["Bolts", true],
    ["Enclosures", false],
  ]);
  await click(items[2] as HTMLElement);
  expect(button("Move", host.querySelector(".dialog-panel")!)).toHaveProperty(
    "disabled",
    true,
  );
  await click(button("Cancel", host.querySelector(".dialog-panel")!));
  expect(host.querySelector(".dialog-panel")).toBeNull();
});

it("shows the server's refusal for a folder with items and confirms an empty one", async () => {
  folders = [
    { id: "f1", name: "Brackets", parentId: null },
    { id: "f2", name: "Enclosures", parentId: null },
  ];
  placement = { p1: "f1" };
  const confirm = vi.fn(() => true);
  vi.stubGlobal("confirm", confirm);
  await renderAt("/");

  await menu(row("Brackets"), "Delete");
  expect(confirm).not.toHaveBeenCalled();
  expect(host.querySelector(".error-banner")?.textContent).toBe(
    'Folder "Brackets" is not empty. Move or delete its 1 items first.',
  );

  await click(
    row("Enclosures").querySelector<HTMLElement>('[title="Delete"]')!,
  );
  expect(confirm).toHaveBeenCalledWith('Delete folder "Enclosures"?');
  expect(rowNames()).toEqual(["Brackets", "Motor mount"]);
});

it("creates a new project in the open folder and says when a folder is empty", async () => {
  folders = [{ id: "f1", name: "Brackets", parentId: null }];
  await renderAt("/folders/f1");
  expect(host.querySelector(".tree-empty")?.textContent).toBe(
    "This folder is empty. Drag a project here or Move to.",
  );
  await click(button("Create"));
  const [, init] = fetchStub.mock.calls.find(
    ([url, i]) => url === "/api/projects" && i.method === "POST",
  )!;
  expect(JSON.parse(init.body as string)).toEqual({
    name: "Untitled",
    folderId: "f1",
  });
  expect(openProject).toHaveBeenCalledWith("p9");
});

it("shows the root with Folder not found. for an unknown folder link", async () => {
  await renderAt("/folders/gone");
  expect(host.querySelector(".error-banner")?.textContent).toBe(
    "Folder not found.",
  );
  expect(crumbs()).toEqual(["Projects"]);
  expect(rowNames()).toEqual(["Gearbox lid", "Motor mount"]);
});
