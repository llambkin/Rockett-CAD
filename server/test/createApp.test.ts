import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const ASSET = "console.log('rockett');\n".repeat(200);
const IMMUTABLE = "public, max-age=31536000, immutable";

describe("createApp", () => {
  let clientDir = "";
  let app: TestApp;

  beforeAll(async () => {
    clientDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-client-"));
    await fs.writeFile(path.join(clientDir, "index.html"), "<p>spa</p>");
    await fs.writeFile(path.join(clientDir, "app.js"), "ok()");
    await fs.mkdir(path.join(clientDir, "assets"));
    await fs.writeFile(
      path.join(clientDir, "assets", "index-a1b2c3.js"),
      ASSET,
    );
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

  it("gzips a large JSON response only for a client that accepts gzip", async () => {
    const doc = await app.store.create("Large");
    for (let i = 0; i < 5000; i++)
      doc.bodyMeta[`b:${i}`] = { name: `Body${i}`, visible: true };
    await app.store.save(doc);
    const get = (encoding: string) =>
      app.request(`/api/projects/${doc.id}`, {
        headers: { "Accept-Encoding": encoding },
      });

    const gzipped = await get("gzip");
    expect(gzipped.headers.get("content-encoding")).toBe("gzip");
    expect(gzipped.headers.get("vary")).toContain("Accept-Encoding");
    expect((await gzipped.json()).document).toEqual(doc);

    const plain = await get("identity");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect((await plain.json()).document).toEqual(doc);

    const small = await app.request("/api/health", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(small.headers.get("content-encoding")).toBeNull();
  });

  it("serves static client files", async () => {
    const res = await app.request("/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok()");
  });

  it("gzips a hashed asset when accepted and marks it immutable", async () => {
    const get = (encoding: string) =>
      app.request("/assets/index-a1b2c3.js", {
        headers: { "Accept-Encoding": encoding },
      });

    const gzipped = await get("gzip");
    expect(gzipped.status).toBe(200);
    expect(gzipped.headers.get("content-encoding")).toBe("gzip");
    expect(gzipped.headers.get("vary")).toContain("Accept-Encoding");
    expect(gzipped.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(gzipped.headers.get("content-type")).toContain("javascript");
    expect(await gzipped.text()).toBe(ASSET);

    const plain = await get("identity");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await plain.text()).toBe(ASSET);
  });

  it("marks index.html and a deep link no-cache", async () => {
    for (const url of ["/", "/index.html", "/projects/some/deep/link"]) {
      for (const encoding of ["gzip", "identity"]) {
        const res = await app.request(url, {
          headers: { "Accept-Encoding": encoding },
        });
        expect(res.headers.get("cache-control")).toBe("no-cache");
        expect(await res.text()).toBe("<p>spa</p>");
      }
    }
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
