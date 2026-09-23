import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@rockett/shared";
import { App } from "../../src/App";
import { useStore } from "../../src/store";

const projects: ProjectSummary[] = [
  {
    id: "p1",
    name: "Gearbox lid",
    featureCount: 3,
    createdAt: "2026-09-23T00:00:00Z",
    modifiedAt: "2026-09-23T00:00:00Z",
    status: "ok",
  },
  {
    id: "p2",
    name: "Broken bracket",
    featureCount: 1,
    createdAt: "2026-09-22T00:00:00Z",
    modifiedAt: "2026-09-22T00:00:00Z",
    status: "invalid",
    error: "project p2 is invalid: features/0/type: unknown feature type",
  },
  {
    id: "p3",
    name: "Future hinge",
    featureCount: 2,
    createdAt: "2026-09-21T00:00:00Z",
    modifiedAt: "2026-09-21T00:00:00Z",
    status: "tooNew",
    schemaVersion: 99,
    error:
      "document version 99 is newer than this server reads (3); upgrade the application",
  },
];

let host: HTMLElement;
let root: Root;
const openProject = vi.fn(async (_id: string) => {});

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/projects") return Response.json(projects);
      if (url === "/api/folders")
        return Response.json({ folders: [], placement: {} });
      return new Promise<Response>(() => {});
    }),
  );
  useStore.setState({ projectId: null, error: null, openProject });
  host = document.body.appendChild(document.createElement("div"));
  window.history.replaceState(null, "", "/");
  root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(async () => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  openProject.mockClear();
  vi.unstubAllGlobals();
});

const row = (name: string) =>
  [...host.querySelectorAll<HTMLElement>(".project-row")].find(
    (r) => r.querySelector(".project-open b")?.textContent === name,
  )!;

async function menuLabels(el: Element) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  return [...host.querySelectorAll(".context-menu button")].map(
    (b) => b.textContent,
  );
}

it("shows an invalid project dimmed with its reason and does not open it", async () => {
  const broken = row("Broken bracket");
  expect(broken.classList).toContain("dimmed");
  expect(broken.getAttribute("draggable")).toBe("false");
  expect(broken.querySelector(".project-open span")?.textContent).toBe(
    "project p2 is invalid: features/0/type: unknown feature type",
  );
  await act(async () =>
    broken.querySelector<HTMLElement>(".project-open")!.click(),
  );
  expect(openProject).not.toHaveBeenCalled();
  expect(await menuLabels(broken)).toEqual(["Delete"]);
});

it("shows a project saved by a newer Rockett dimmed with its schema", async () => {
  const future = row("Future hinge");
  expect(future.classList).toContain("dimmed");
  expect(future.querySelector(".project-open span")?.textContent).toBe(
    "Saved by a newer Rockett (schema 99)",
  );
  await act(async () =>
    future.querySelector<HTMLElement>(".project-open")!.click(),
  );
  expect(openProject).not.toHaveBeenCalled();
});

it("still opens a valid project", async () => {
  const ok = row("Gearbox lid");
  expect(ok.classList).not.toContain("dimmed");
  await act(async () =>
    ok.querySelector<HTMLElement>(".project-open")!.click(),
  );
  expect(openProject).toHaveBeenCalledWith("p1");
});
