import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION } from "@rockett/plugin-api";
import { parseManifest } from "@rockett/shared";
import { serverModules } from "../../index.server.js";
import client from "../client.js";
import manifest from "../manifest.json";
import server from "../server.js";

const root = resolve(import.meta.dirname, "../..");

describe("KiCad first-party module", () => {
  it("registers compatible upload and outline routes, the outline command and the board feature with declared contributions", () => {
    expect(parseManifest(manifest, PLUGIN_API_VERSION).status).toBe(
      "compatible",
    );
    expect(manifest.id).toBe("rockett.kicad");
    expect(manifest.licence).toBe("UNLICENSED");
    expect(manifest.contributes).toEqual({
      features: ["rockett.kicad.board"],
      commands: ["rockett.kicad.exportOutline"],
      routes: ["rockett.kicad.upload", "rockett.kicad.outline"],
      menuItems: ["rockett.kicad.exportOutline"],
    });
    expect(
      serverModules.find((entry) => entry.manifest.id === manifest.id),
    ).toEqual({ manifest, server, folder: new URL("../", import.meta.url) });
    expect(server.activate).toBeTypeOf("function");
    expect(client.activate).toBeTypeOf("function");
    expect(readFileSync(resolve(root, "kicad/LICENSE"), "utf8")).toContain(
      "No licence grant",
    );
  });

  it("includes the client shell and package in both Docker dependency stages", () => {
    const index = readFileSync(resolve(root, "index.client.ts"), "utf8");
    expect(index).toContain(
      'import kicadManifest from "./kicad/manifest.json"',
    );
    expect(index).toContain('import kicadClient from "./kicad/client"');
    expect(index).toMatch(
      /manifest: kicadManifest, client: kicadClient, icons: \{\}/,
    );
    const dockerfile = readFileSync(resolve(root, "../Dockerfile"), "utf8");
    expect(
      dockerfile.match(
        /^COPY modules\/kicad\/package.json modules\/kicad\/package.json$/gm,
      ),
    ).toHaveLength(2);
  });
});
