import { globSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { parseSync } from "rolldown/experimental";
import { expect, it } from "vitest";

export function runtimeCycles(sources: Record<string, string>): string[][] {
  const graph = new Map<string, string[]>();
  for (const [file, source] of Object.entries(sources)) {
    const parsed = parseSync(
      file.replace(/\.ts$/, ".js"),
      stripTypeScriptTypes(source, { mode: "transform" }),
    );
    if (parsed.errors.length) throw new Error("Module graph source must parse");
    const edges: string[] = [];
    for (const declaration of parsed.program.body) {
      if (
        (declaration.type === "ImportDeclaration" ||
          declaration.type === "ExportNamedDeclaration" ||
          declaration.type === "ExportAllDeclaration") &&
        declaration.source &&
        typeof declaration.source.value === "string" &&
        declaration.source.value.startsWith(".")
      ) {
        const target = path.posix
          .normalize(
            path.posix.join(path.posix.dirname(file), declaration.source.value),
          )
          .replace(/\.js$/, ".ts");
        if (Object.hasOwn(sources, target)) edges.push(target);
      }
    }
    graph.set(file, edges);
  }
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const active: string[] = [];
  function visit(file: string): void {
    const ancestor = active.indexOf(file);
    if (ancestor !== -1) {
      cycles.push([...active.slice(ancestor), file]);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    active.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    active.pop();
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}

it("rejects runtime reexport cycles while erasing type-only declarations", () => {
  expect(
    runtimeCycles({
      "a.ts": 'export * from "./b.js";',
      "b.ts": 'import { value } from "./a.js";',
    }),
  ).toEqual([["a.ts", "b.ts", "a.ts"]]);
  expect(
    runtimeCycles({
      "a.ts": 'export * from "./b.js";',
      "b.ts": 'import type { Value } from "./a.js";',
    }),
  ).toEqual([]);
  expect(
    runtimeCycles({
      "a.ts": 'export * from "./b.js";',
      "b.ts": 'import { type Value } from "./a.js";',
    }),
  ).toEqual([["a.ts", "b.ts", "a.ts"]]);
});

it("keeps the shared runtime module graph acyclic", () => {
  const shared = path.resolve(import.meta.dirname, "../../shared/src");
  const sources = Object.fromEntries(
    globSync("**/*.ts", { cwd: shared })
      .filter((file) => !file.endsWith(".test.ts"))
      .map((file) => [file, readFileSync(path.join(shared, file), "utf8")]),
  );
  expect(runtimeCycles(sources)).toEqual([]);
});
