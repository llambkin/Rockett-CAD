import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api, request } from "../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("turns a coded 404 body into an ApiError", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "Project not found", code: "not_found" },
        { status: 404 },
      ),
    ),
  );
  const err = await api.getProject("missing").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({
    status: 404,
    code: "not_found",
    message: "Project not found",
  });
});

it("keeps the detail field", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "Invalid feature", code: "validation", detail: "depth" },
        { status: 400 },
      ),
    ),
  );
  await expect(request("GET", "/projects")).rejects.toMatchObject({
    status: 400,
    code: "validation",
    detail: "depth",
  });
});

it("turns a non-JSON 502 into an internal ApiError", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }),
    ),
  );
  const err = await api.listProjects().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({
    status: 502,
    code: "internal",
    message: "Bad Gateway",
  });
});

it("rejects with AbortError when the signal aborts", async () => {
  const fetchStub = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchStub);
  const controller = new AbortController();
  const pending = request("POST", "/projects", {
    body: { name: "x" },
    signal: controller.signal,
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchStub).toHaveBeenCalledWith(
    "/api/projects",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "x" }),
      signal: controller.signal,
    }),
  );
});
