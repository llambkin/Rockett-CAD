import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "rockett-pack-test-"));
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const repo = (path: string) => readFileSync(join(root, path));
const pack = (outDir: string) =>
  spawnSync(process.execPath, ["scripts/cam-qualify-pack.mjs", outDir], {
    cwd: root,
    encoding: "utf8",
  });

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("cam-qualify-pack", () => {
  it("writes the reference program with matching hashes", () => {
    const out = join(tmp, "pack");
    const run = pack(out);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(out, "pack.json"), "utf8"));
    expect(manifest.cam).toBe(
      JSON.parse(repo("modules/cam/manifest.json").toString()).version,
    );
    expect(manifest.post).toEqual({
      id: "grbl",
      sha256: sha256(repo("modules/cam/posts/grbl.json")),
    });
    const names = manifest.files.map((file: { name: string }) => file.name);
    expect(names).toEqual([
      "facing.nc",
      "contour.nc",
      "pocket.nc",
      "drill-1.nc",
      "drill-2.nc",
    ]);
    expect(new Set(readdirSync(out))).toEqual(new Set([...names, "pack.json"]));
    for (const file of manifest.files) {
      const bytes = readFileSync(join(out, file.name));
      expect(file.sha256).toBe(sha256(bytes));
      expect(bytes).toEqual(repo(`modules/cam/test/golden/grbl/${file.name}`));
    }
  });

  it("refuses an outDir inside the repository", () => {
    const inside = join(root, "modules/cam/test/pack-inside");
    const run = pack(inside);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/inside the repository/);
    expect(existsSync(inside)).toBe(false);
  });

  it("refuses a non-empty outDir", () => {
    const full = mkdtempSync(join(tmp, "full-"));
    writeFileSync(join(full, "keep.nc"), "G0\n");
    const run = pack(full);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/not empty/);
    expect(readdirSync(full)).toEqual(["keep.nc"]);
  });

  it("asks for an outDir", () => {
    const run = pack("");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^usage: /);
  });
});
