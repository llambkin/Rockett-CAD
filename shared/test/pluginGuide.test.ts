import { PLUGIN_API_VERSION } from "@rockett/plugin-api";
import { expect, it, vi } from "vitest";
import { parseManifest } from "../src/index.js";

const { readFileSync } = await vi.importActual<{
  readFileSync(file: URL, encoding: "utf8"): string;
}>("node:fs");
const guide = readFileSync(
  new URL("../../docs/user/plugins.md", import.meta.url),
  "utf8",
);
const manifests = [...guide.matchAll(/^```json\n([\s\S]*?)^```$/gm)].map(
  ([, json]) => JSON.parse(json!) as unknown,
);

it("every manifest example in the plugin guide passes parseManifest on this host", () => {
  expect(manifests.length).toBeGreaterThanOrEqual(2);
  for (const manifest of manifests)
    expect(parseManifest(manifest, PLUGIN_API_VERSION)).toMatchObject({
      status: "compatible",
    });
});
