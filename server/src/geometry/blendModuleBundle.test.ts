import { build } from "esbuild";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("a relocated server bundle loads its adjacent exact blend module", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "blend-bundle-"));
  try {
    const bundle = join(dir, "probe.mjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("./blendModule.ts", import.meta.url)),
      ],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      define: { BLEND_WASM_URL: JSON.stringify("./blend.wasm") },
    });
    copyFileSync(
      new URL("../../../modules/kernel/blend/blend.wasm", import.meta.url),
      join(dir, "blend.wasm"),
    );
    const running = promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { filletBetweenPlanes } from ${JSON.stringify(bundle)}; console.log(JSON.stringify(filletBetweenPlanes([[0,0,0],[10,0,0]], [{normal:[0,0,1],into:[0,1,0]},{normal:[0,-1,0],into:[0,0,-1]}],2)[0].centre));`,
      ],
      {
        encoding: "utf8",
        cwd: dir,
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
      expect(JSON.parse(stdout)).toEqual([0, 2, -2]);
    } finally {
      await closed;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
