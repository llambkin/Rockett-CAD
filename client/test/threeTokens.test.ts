import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { themeColor } from "../src/theme/tokens";

const dir = fileURLToPath(new URL("../src/three/", import.meta.url));

it("keeps every hex colour literal out of client/src/three", () => {
  const found = readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) =>
      (
        readFileSync(dir + file, "utf8").match(
          /\b0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,8}\b/g,
        ) ?? []
      ).map((literal) => `${file}: ${literal}`),
    );
  expect(found).toEqual([]);
});

it("keeps today's viewport colours", () => {
  expect({
    body: themeColor("body"),
    edge: themeColor("edge"),
    selection: themeColor("selection"),
    sketchLine: themeColor("sketch-line"),
  }).toEqual({
    body: "#b7bcc1",
    edge: "#30343a",
    selection: "#4da3ff",
    sketchLine: "#3ba1e8",
  });
});
