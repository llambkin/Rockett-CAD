import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, emptyView } from "@rockett/shared";
import { useStore } from "../src/store";
import { followPath } from "../src/browserSession";
import { api } from "../src/api";
import { backToProjects } from "../src/components/ProjectList";
import {
  browserKeyFromPath,
  browserProjectPath,
  folderIdFromPath,
  isBrowserPath,
  projectIdFromPath,
} from "../src/paths";
vi.mock("../src/api", () => ({
  api: {
    getProject: vi.fn(),
    getView: vi.fn(),
    evaluate: vi.fn(),
    listFolders: vi.fn(),
  },
}));

const location = { pathname: "/" };
const entries: string[] = [];
const history = {
  pushState: vi.fn((_s: unknown, _t: string, path: string) => {
    entries.push(path);
    location.pathname = path;
  }),
  replaceState: vi.fn((_s: unknown, _t: string, path: string) => {
    entries[entries.length - 1] = path;
    location.pathname = path;
  }),
};
vi.stubGlobal("window", { location, history });

beforeEach(() => {
  vi.clearAllMocks();
  location.pathname = "/";
  entries.splice(0, entries.length, "/");
  useStore.setState(useStore.getInitialState());
  vi.mocked(api.getProject).mockImplementation(async (id) => ({
    document: createEmptyDocument(id, "Doc"),
  }));
  vi.mocked(api.getView).mockResolvedValue(emptyView());
  vi.mocked(api.evaluate).mockResolvedValue({} as any);
  vi.mocked(api.listFolders).mockResolvedValue({
    folders: [{ id: "f 1", name: "Brackets", parentId: null }],
    placement: { p1: "f 1", p2: "gone" },
  });
});

it("opening pushes the encoded project path and Back to projects pushes /", async () => {
  await useStore.getState().openProject("a b");
  expect(location.pathname).toBe("/projects/a%20b");
  await backToProjects();
  expect(useStore.getState().projectId).toBeNull();
  expect(entries).toEqual(["/", "/projects/a%20b", "/"]);
});

it("Back to projects returns to the project's folder, or the root when it is missing", async () => {
  await useStore.getState().openProject("p1");
  await backToProjects();
  expect(location.pathname).toBe("/folders/f%201");
  await useStore.getState().openProject("p2");
  await backToProjects();
  expect(location.pathname).toBe("/");
  vi.mocked(api.listFolders).mockRejectedValue(new Error("offline"));
  await useStore.getState().openProject("p1");
  await backToProjects();
  expect(location.pathname).toBe("/");
});

it("a folder path closes an open project without a new entry", async () => {
  await useStore.getState().openProject("p1");
  location.pathname = "/folders/f1";
  await followPath();
  expect(useStore.getState().projectId).toBeNull();
  expect(history.pushState).toHaveBeenCalledTimes(1);
});

it("/browser is neither a folder nor a project, and closes an open project", async () => {
  expect(isBrowserPath("/browser")).toBe(true);
  expect(isBrowserPath("/browser/k1")).toBe(false);
  expect(folderIdFromPath("/browser")).toBeNull();
  await useStore.getState().openProject("p1");
  location.pathname = "/browser";
  await followPath();
  expect(useStore.getState().projectId).toBeNull();
  expect(history.pushState).toHaveBeenCalledTimes(1);
});

it("a browser project path names its record, not a project", () => {
  expect(browserProjectPath("k 1")).toBe("/browser/k%201");
  expect(browserKeyFromPath("/browser/k%201")).toBe("k 1");
  expect(browserKeyFromPath("/browser")).toBeNull();
  expect(projectIdFromPath("/browser/k1")).toBeNull();
});

it("a store started at a project path opens that project without a new entry", async () => {
  location.pathname = "/projects/a%20b";
  entries.splice(0, entries.length, location.pathname);
  await followPath();
  expect(api.getProject).toHaveBeenCalledWith("a b");
  expect(useStore.getState().projectId).toBe("a b");
  expect(entries).toEqual(["/projects/a%20b"]);
});

it("Back to / closes the project and Forward reopens it without new entries", async () => {
  await useStore.getState().openProject("p1");
  location.pathname = "/";
  await followPath();
  expect(useStore.getState().projectId).toBeNull();
  location.pathname = "/projects/p1";
  await followPath();
  expect(useStore.getState().projectId).toBe("p1");
  expect(history.pushState).toHaveBeenCalledTimes(1);
});

it("a path naming a missing project shows the list with the load error", async () => {
  vi.mocked(api.getProject).mockRejectedValue(new Error("Project not found"));
  location.pathname = "/projects/gone";
  await followPath();
  const s = useStore.getState();
  expect(s.projectId).toBeNull();
  expect(s.error).toBe("Project not found");
  expect(location.pathname).toBe("/");
  expect(history.pushState).not.toHaveBeenCalled();
});
