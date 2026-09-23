import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { followPath, useStore } from "../src/store";
import { api } from "../src/api";
vi.mock("../src/api", () => ({
  api: { getProject: vi.fn(), evaluate: vi.fn() },
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
  vi.mocked(api.evaluate).mockResolvedValue({} as any);
});

it("opening pushes the encoded project path and closing pushes /", async () => {
  await useStore.getState().openProject("a b");
  expect(location.pathname).toBe("/projects/a%20b");
  useStore.getState().closeProject();
  expect(location.pathname).toBe("/");
  expect(entries).toEqual(["/", "/projects/a%20b", "/"]);
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
