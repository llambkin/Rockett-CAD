import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const RUNTIME =
  /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']/gm;

function reach(entry: string): string[] {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const [, specifier = ""] of readFileSync(file, "utf8").matchAll(
      RUNTIME,
    )) {
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      const source = target.replace(/\.js$/, ".ts");
      visit(existsSync(source) ? source : target);
    }
  };
  visit(join(root, entry));
  return [...[...files].map((file) => relative(root, file)), ...packages];
}

it("keeps toolpath and kernel job code out of the server entry", () => {
  const reached = reach("server.ts");
  expect(reached).toContain("src/server/generate.ts");
  expect(
    reached.filter((name) =>
      /^src\/(kernel|toolpath)\/|^clipper2-ts\b/.test(name),
    ),
  ).toEqual([]);
});
