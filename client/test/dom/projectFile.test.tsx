import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { useStore } from "../../src/store";

const plate = {
  id: "p1",
  name: "Pläte",
  featureCount: 2,
  createdAt: "2026-09-23T00:00:00Z",
  modifiedAt: "2026-09-23T00:00:00Z",
};

let host: HTMLElement;
let root: Root;
let upload: () => Response;
const openProject = vi.fn(async (_id: string) => {});
const saved: string[] = [];
const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
  if (url === "/api/health") return new Promise<Response>(() => {});
  if (url === "/api/projects" && init.method === "GET")
    return Response.json([plate]);
  if (url === "/api/folders")
    return Response.json({ folders: [], placement: {} });
  if (url === "/api/projects/p1/file" && init.method === "GET")
    return new Response("{}", {
      headers: {
        "Content-Disposition":
          "attachment; filename=\"Pl_te.rockett\"; filename*=UTF-8''Pl%C3%A4te.rockett",
      },
    });
  if (url === "/api/projects/file" && init.method === "POST") return upload();
  return Response.json(
    { error: "Unexpected", code: "internal" },
    { status: 500 },
  );
});

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchStub);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
  useStore.setState({ projectId: null, error: null, openProject });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(async () => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  fetchStub.mockClear();
  openProject.mockClear();
  saved.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const calls = (path: string) =>
  fetchStub.mock.calls.filter(([url]) => url === path);

it("downloads the project file from the row button and the row menu", async () => {
  const button = host.querySelector<HTMLElement>(
    '.project-row [aria-label="Download Pläte"]',
  )!;
  await act(async () => button.click());
  expect(calls("/api/projects/p1/file")).toHaveLength(1);
  expect(saved).toEqual(["Pläte.rockett"]);

  await act(async () => {
    host
      .querySelector(".project-row")!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
  });
  const item = [...host.querySelectorAll(".context-menu button")].find(
    (b) => b.textContent === "Download",
  ) as HTMLElement;
  await act(async () => item.click());
  expect(calls("/api/projects/p1/file")).toHaveLength(2);
  expect(saved).toEqual(["Pläte.rockett", "Pläte.rockett"]);
});

async function chooseProjectFile(file: File) {
  const input = host.querySelector<HTMLInputElement>(
    'input[type="file"][aria-label="Project file"]',
  )!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("posts the chosen project file and opens the new project", async () => {
  upload = () => Response.json({ document: { id: "p2" } });
  const file = new File(["{}"], "plate.rockett");
  await chooseProjectFile(file);
  const [[, init]] = calls("/api/projects/file") as [[string, RequestInit]];
  expect((init.body as FormData).get("file")).toBe(file);
  expect(openProject).toHaveBeenCalledWith("p2");
});

it("shows an upload error in the error banner", async () => {
  upload = () =>
    Response.json(
      { error: "This is not a Rockett project file", code: "validation" },
      { status: 400 },
    );
  await chooseProjectFile(new File(["x"], "plate.rockett"));
  expect(openProject).not.toHaveBeenCalled();
  expect(host.querySelector(".error-banner")?.textContent).toBe(
    "This is not a Rockett project file",
  );
});
