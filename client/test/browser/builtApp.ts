import { randomUUID } from "node:crypto";
import { hotp, totpStep } from "../../../server/src/auth/totp";
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const serverEntry = path.join(root, "server/dist/server.mjs");
const clientIndex = path.join(root, "client/dist/index.html");
const START_TIMEOUT_MS = 30_000;

export interface BuiltApp {
  origin: string;
  serverErrors: string[];
  cookie: string;
  close(): Promise<void>;
}

export async function startBuiltApp(): Promise<BuiltApp> {
  for (const file of [serverEntry, clientIndex])
    if (!existsSync(file))
      throw new Error(
        `${path.relative(root, file)} is missing; run npm run build`,
      );
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-browser-"));
  const setupToken = randomUUID();
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      ROCKETT_PORT: String(port),
      ROCKETT_ALLOWED_ORIGINS: origin,
      DATA_DIR: dataDir,
      ROCKETT_COOKIE_SECURE: "false",
      ROCKETT_SETUP_TOKEN: setupToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  const serverErrors: string[] = [];
  child.stderr
    .setEncoding("utf8")
    .on("data", (s: string) => serverErrors.push(s));

  const close = async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await exited;
    await fs.rm(dataDir, { recursive: true, force: true });
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(
        () =>
          reject(
            new Error(`server did not listen within ${START_TIMEOUT_MS} ms`),
          ),
        START_TIMEOUT_MS,
      );
      child.stdout.setEncoding("utf8").on("data", (s: string) => {
        out += s;
        if (/listening on http:\/\/[^:]+:\d+/.test(out)) {
          clearTimeout(timer);
          resolve();
        }
      });
      void exited.then(() => {
        clearTimeout(timer);
        reject(
          new Error(`server exited before listening: ${serverErrors.join("")}`),
        );
      });
    });
    let cookie = "";
    const post = async (route: string, body: unknown = {}) => {
      const response = await fetch(origin + "/api" + route, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(route + " returned " + response.status);
      cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      return response.json();
    };
    const account = {
      username: "browser-test",
      password: randomUUID(),
      displayName: "Browser Test",
    };
    await post("/auth/setup", { ...account, token: setupToken });
    await post("/auth/login", {
      username: account.username,
      password: account.password,
    });
    const { secret } = (await post("/me/totp")) as { secret: string };
    const bits = [...secret]
      .map((c) =>
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
          .indexOf(c)
          .toString(2)
          .padStart(5, "0"),
      )
      .join("");
    const key = Buffer.from(
      bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
    );
    await post("/me/totp/confirm", { code: hotp(key, totpStep(Date.now())) });
    return { origin, serverErrors, cookie, close };
  } catch (err) {
    await close();
    throw err;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
