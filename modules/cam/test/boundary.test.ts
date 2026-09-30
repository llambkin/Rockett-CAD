import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Manifest = { dependencies?: Record<string, string> };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

function pinned(manifest: Manifest): Set<string> {
  return new Set(
    Object.entries(manifest.dependencies ?? {})
      .filter(([, version]) => EXACT.test(version))
      .map(([name]) => name),
  );
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function outside(file: string, source: string, allowed: Set<string>) {
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[1]!)
    .filter((specifier) =>
      specifier.startsWith(".")
        ? !resolve(dirname(file), specifier).startsWith(root + sep)
        : !allowed.has(packageName(specifier)),
    );
}

function sources(): string[] {
  if (!existsSync(src)) return [];
  return readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter(
      (name) =>
        /\.[cm]?[jt]sx?$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name),
    )
    .map((name) => join(src, name));
}

describe("module-cam boundary", () => {
  it("imports only its own files and exactly pinned packages", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as Manifest;
    const allowed = pinned(manifest);
    const found = sources().flatMap((file) =>
      outside(file, readFileSync(file, "utf8"), allowed).map(
        (specifier) => `${relative(root, file)}: ${specifier}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it("allows only exact pins", () => {
    const manifest = {
      dependencies: { exact: "2.0.1-18", caret: "^1.0.0", tilde: "~1.0.0" },
    };
    expect([...pinned(manifest)]).toEqual(["exact"]);
  });

  it("rejects core paths, unpinned packages and builtins", () => {
    const file = join(src, "post", "format.ts");
    const source = [
      'import { ir } from "../shared/ir";',
      'import posts from "../../posts/grbl.json";',
      'import { run } from "../../../../server/src/index";',
      'export * from "@rockett/shared";',
      'import "express";',
      'const fs = await import("node:fs");',
      'const offsets = require("@scope/pinned/lib");',
    ].join("\n");
    expect(outside(file, source, new Set(["@scope/pinned"]))).toEqual([
      "../../../../server/src/index",
      "@rockett/shared",
      "express",
      "node:fs",
    ]);
  });
});
