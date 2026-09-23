import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

describe("createApp", () => {
  let clientDir = "";
  let app: TestApp;

  beforeAll(async () => {
    clientDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-client-"));
    await fs.writeFile(path.join(clientDir, "index.html"), "<p>spa</p>");
    await fs.writeFile(path.join(clientDir, "app.js"), "ok()");
    app = await startTestApp({ clientDir });
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(clientDir, { recursive: true, force: true });
  });

  it("answers GET /api/health with the build fields", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, version });
    expect(body).toHaveProperty("commit");
    expect(body).toHaveProperty("describe");
  });

  it("answers an unknown API path with a JSON 404", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("serves static client files", async () => {
    const res = await app.request("/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok()");
  });

  it("serves index.html for an unknown non-API path", async () => {
    const res = await app.request("/projects/some/deep/link");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<p>spa</p>");
  });

  it("serves the API alone when no client dir is given", async () => {
    const apiOnly = await startTestApp();
    try {
      expect((await apiOnly.request("/api/health")).status).toBe(200);
      expect((await apiOnly.request("/anything")).status).toBe(404);
    } finally {
      await apiOnly.close();
    }
  });
});
