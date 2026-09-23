import { defineConfig } from "vitest/config";

export const projects = [
  {
    name: "node",
    environment: "node",
    include: [
      "shared/test/**/*.test.ts",
      "server/test/**/*.test.ts",
      "client/test/**/*.test.ts",
      "modules/*/test/**/*.test.ts",
    ],
    exclude: ["**/test/dom/**", "**/test/browser/**"],
  },
  {
    name: "dom",
    environment: "happy-dom",
    include: [
      "client/test/dom/**/*.test.{ts,tsx}",
      "modules/*/test/dom/**/*.test.{ts,tsx}",
    ],
    exclude: [],
    setupFiles: ["client/test/dom/setup.ts"],
  },
  {
    name: "browser",
    environment: "node",
    include: ["client/test/browser/**/*.test.ts"],
    exclude: [],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
];

export default defineConfig({
  test: { projects: projects.map((test) => ({ test })) },
});
