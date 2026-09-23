import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

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
