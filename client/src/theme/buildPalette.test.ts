import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadConfigFromFile } from "vite";
import { expect, it } from "vitest";

it("imports the actual HTML palette hook without loading runtime settings", async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const scratch = await mkdtemp(path.join(tmpdir(), "palette-config-"));
  const client = path.join(scratch, "client");
  try {
    await mkdir(path.join(client, "src"), { recursive: true });
    await cp(
      path.join(root, "client/src/theme"),
      path.join(client, "src/theme"),
      {
        recursive: true,
      },
    );
    await cp(
      path.join(root, "client/vite.config.ts"),
      path.join(client, "vite.config.ts"),
    );
    await writeFile(
      path.join(client, "src/settings.ts"),
      'throw new Error("Runtime settings loaded by build config");\nexport const getSetting = null;\nexport const subscribe = null;\n',
    );
    await writeFile(path.join(scratch, "package.json"), '{"type":"module"}');
    await symlink(
      path.join(root, "shared"),
      path.join(scratch, "shared"),
      "dir",
    );
    await symlink(
      path.join(root, "node_modules"),
      path.join(scratch, "node_modules"),
      "dir",
    );
    const loaded = await loadConfigFromFile(
      { command: "build", mode: "production" },
      path.join(client, "vite.config.ts"),
      client,
      "silent",
    );
    const plugin = loaded?.config.plugins?.find(
      (candidate) =>
        candidate && "name" in candidate && candidate.name === "paint-bg0",
    );
    if (!plugin || !("transformIndexHtml" in plugin))
      throw new Error("Missing HTML palette plugin");
    const hook = plugin.transformIndexHtml;
    if (typeof hook !== "function")
      throw new Error("Missing HTML palette hook");
    const result = await Reflect.apply(hook, undefined, [
      "",
      { path: "/", filename: path.join(client, "index.html") },
    ]);
    expect(result).toEqual([
      {
        tag: "style",
        children: "html{--bg0:#1e2124;background:var(--bg0)}",
        injectTo: "head",
      },
    ]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
