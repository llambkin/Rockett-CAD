import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const serverEntry = path.join(root, "server/dist/server.js");
const clientIndex = path.join(root, "client/dist/index.html");
const START_TIMEOUT_MS = 30_000;

export interface BuiltApp {
  origin: string;
  serverErrors: string[];
  close(): Promise<void>;
}

export async function startBuiltApp(): Promise<BuiltApp> {
  for (const file of [serverEntry, clientIndex])
    if (!existsSync(file))
      throw new Error(
        `${path.relative(root, file)} is missing; run npm run build`,
      );
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-browser-"));
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: { PATH: process.env.PATH, ROCKETT_PORT: "0", DATA_DIR: dataDir },
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
    const port = await new Promise<string>((resolve, reject) => {
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
        const found = /listening on http:\/\/[^:]+:(\d+)/.exec(out)?.[1];
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      });
      void exited.then(() => {
        clearTimeout(timer);
        reject(
          new Error(`server exited before listening: ${serverErrors.join("")}`),
        );
      });
    });
    return { origin: `http://127.0.0.1:${port}`, serverErrors, close };
  } catch (err) {
    await close();
    throw err;
  }
}
