import { globSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { projects } from "../../vitest.config";

const root = path.resolve(import.meta.dirname, "../..");
const skip = ["**/node_modules/**", "**/dist/**", ".git/**"];

it("runs pure client tests without a DOM", () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
});

it("assigns every test file to exactly one project", () => {
  const owners = new Map<string, string[]>();
  for (const file of globSync("**/*.{test,spec}.*", {
    cwd: root,
    exclude: skip,
  }))
    owners.set(file, []);
  for (const project of projects)
    for (const file of globSync(project.include, {
      cwd: root,
      exclude: [...skip, ...project.exclude],
    }))
      owners.get(file)?.push(project.name);

  const misplaced = [...owners].filter(([, names]) => names.length !== 1);
  expect(misplaced).toEqual([]);
  expect(owners.get("client/test/testProjects.test.ts")).toEqual(["node"]);
  expect(owners.get("client/test/dom/toolbar.test.tsx")).toEqual(["dom"]);
});
