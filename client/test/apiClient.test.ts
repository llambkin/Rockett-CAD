import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("upload and export", () => {
  it("turns a 413 upload into a too_large ApiError", async () => {
    const fetchStub = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(
        { error: "File too large", code: "too_large" },
        { status: 413 },
      ),
    );
    vi.stubGlobal("fetch", fetchStub);
    const controller = new AbortController();
    const file = new File(["x"], "big.png", { type: "image/png" });
    const err = await api
      .uploadImage("p1", file, controller.signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 413, code: "too_large" });
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe("/api/projects/p1/assets");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBe(controller.signal);
  });

  it("returns the export file name from Content-Disposition", async () => {
    const fetchStub = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response("solid", {
          headers: { "Content-Disposition": 'attachment; filename="part.stl"' },
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const { blob, fileName } = await api.exportModel("p1", {
      format: "stl",
      bodyIds: [],
    });
    expect(fileName).toBe("part.stl");
    expect(await blob.text()).toBe("solid");
    expect(fetchStub.mock.calls[0]![1].body).toBe(
      JSON.stringify({ format: "stl", bodyIds: [] }),
    );
  });

  it("turns a failed STEP import into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "File too large", code: "too_large" },
          { status: 413 },
        ),
      ),
    );
    const file = new File(["x"], "a.step");
    await expect(api.importStep(file)).rejects.toMatchObject({
      status: 413,
      code: "too_large",
    });
  });
});
