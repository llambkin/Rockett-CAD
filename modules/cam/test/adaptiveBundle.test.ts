import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("a bundled CAM kernel carries the exact adaptive engine with no file beside it", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "adaptive-bundle-"));
  try {
    const bundle = join(dir, "probe.mjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/kernel/generate.ts", import.meta.url)),
      ],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      loader: { ".wasm": "dataurl" },
    });
    const running = promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { adaptiveEngine } from ${JSON.stringify(bundle)}; console.log(JSON.stringify(WebAssembly.Module.exports(adaptiveEngine()).map(({ name }) => name).filter((name) => name === "adaptive")));`,
      ],
      {
        encoding: "utf8",
        cwd: tmpdir(),
        signal: context.signal,
        killSignal: "SIGKILL",
        maxBuffer: 1 << 20,
      },
    );
    const closed = new Promise<void>((resolve) => {
      running.child.once("close", () => resolve());
    });
    try {
      const { stdout } = await running;
      expect(JSON.parse(stdout)).toEqual(["adaptive"]);
    } finally {
      await closed;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
