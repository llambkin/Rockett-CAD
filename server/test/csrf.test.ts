import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { parseAllowedOrigins } from "../src/auth/origin.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const DEV = "http://localhost:5173";
const DEPLOY = "https://localhost";

function raw(
  app: TestApp,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${app.origin}${path}`,
      { method, headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("parseAllowedOrigins", () => {
  it("normalises each listed origin", () => {
    expect(
      parseAllowedOrigins(" HTTP://LocalHost:5173 ,https://localhost:443/,"),
    ).toEqual([DEV, DEPLOY]);
  });

  it.each([
    undefined,
    "",
    " , ",
    "*",
    "https://*.localhost",
    "http://localhost:5173/app",
    "http://localhost:5173?x=1",
    "http://user:pass@localhost",
    "file:///tmp",
    "localhost:5173",
  ])("refuses %j with one line naming the variable", (value) => {
    expect(() => parseAllowedOrigins(value)).toThrow(
      /^ROCKETT_ALLOWED_ORIGINS [^\n]+$/,
    );
  });
});

describe("server startup", () => {
  it.each([undefined, "http://localhost:5173/app", "https://*.localhost"])(
    "exits with one line for ROCKETT_ALLOWED_ORIGINS=%j",
    (value) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ROCKETT_PORT: "0",
        ROCKETT_ALLOWED_ORIGINS: value,
      };
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", "server/src/index.ts"],
        {
          cwd: new URL("../..", import.meta.url),
          env,
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toMatch(
        /^\[rockett\] ROCKETT_ALLOWED_ORIGINS [^\n]+\n$/,
      );
    },
  );
});

describe("origin check", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp({ allowedOrigins: [DEV, DEPLOY] });
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (origin?: string) =>
    app.request("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin === undefined ? {} : { Origin: origin }),
      },
      body: JSON.stringify({ name: "Origin" }),
    });

  it("accepts the harness, development and deployment origins", async () => {
    for (const origin of [undefined, DEV, DEPLOY]) {
      expect((await create(origin)).status).toBe(200);
    }
  });

  it("rejects a wrong scheme, port or host", async () => {
    const port = Number(new URL(app.origin).port);
    for (const origin of [
      `https://127.0.0.1:${port}`,
      `http://127.0.0.1:${port + 1}`,
      "http://localhost:5174",
      "http://localhost",
      "null",
    ]) {
      const res = await create(origin);
      expect(res.status, origin).toBe(403);
      expect(await res.json()).toEqual({ error: "Origin not allowed" });
    }
  });

  it("rejects a state change with no Origin header", async () => {
    expect(
      await raw(app, "POST", "/api/projects", {
        "Content-Type": "application/json",
      }),
    ).toBe(403);
  });

  it("ignores forged Host and forwarded headers", async () => {
    const forged = "http://evil.localhost:8080";
    expect(
      await raw(app, "POST", "/api/projects", {
        Origin: forged,
        Host: "evil.localhost:8080",
        "X-Forwarded-Host": "evil.localhost:8080",
        "X-Forwarded-Proto": "http",
        Forwarded: "host=evil.localhost:8080;proto=http",
      }),
    ).toBe(403);
  });

  it("guards every state-changing method before routing", async () => {
    for (const [method, path] of [
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/setup"],
      ["PUT", "/api/projects/x"],
      ["PATCH", "/api/projects/x"],
      ["DELETE", "/api/projects/x"],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { Origin: "http://localhost:9" },
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("rejects a cross-site multipart upload and writes nothing", async () => {
    const before = (await app.store.list()).length;
    const form = new FormData();
    form.append("file", new Blob(["ISO-10303-21;"]), "part.step");
    const res = await app.request("/api/projects/import-step", {
      method: "POST",
      headers: { Origin: "http://localhost:9" },
      body: form,
    });
    expect(res.status).toBe(403);
    expect((await app.store.list()).length).toBe(before);
  });

  it("leaves reads open without an Origin header", async () => {
    expect(await raw(app, "GET", "/api/health", {})).toBe(200);
  });
});
