import { describe, expect, it } from "vitest";
import { parseManifest, ValidationError } from "../src/index.js";

const manifest = (over: Record<string, unknown> = {}) => ({
  manifestVersion: 1,
  id: "rockett.cam",
  name: "CAM",
  version: "0.1.0",
  apiRange: "^1.2",
  licence: "MIT",
  author: "Rockett",
  contributes: {
    commands: ["rockett.cam.setup"],
    workbenches: ["rockett.cam.manufacture"],
    postProcessors: ["rockett.cam.grbl"],
    settings: ["plugin.rockett.cam.units"],
  },
  ...over,
});

const invalid = (value: unknown, message: RegExp) => {
  expect(() => parseManifest(value, "1.4.0")).toThrow(ValidationError);
  expect(() => parseManifest(value, "1.4.0")).toThrow(message);
};

describe("parseManifest", () => {
  it("accepts a manifest whose range covers the host", () => {
    expect(parseManifest(manifest(), "1.4.0")).toEqual({
      status: "compatible",
      manifest: manifest(),
    });
  });

  it("reports a ^2.0 range on a 1.x host as incompatible with the reason", () => {
    expect(parseManifest(manifest({ apiRange: "^2.0" }), "1.4.0")).toEqual({
      status: "incompatible",
      manifest: manifest({ apiRange: "^2.0" }),
      reason: "rockett.cam needs plugin API ^2.0; this host has 1.4.0",
    });
  });

  it.each([
    ["^1.5", "1.4.0", "incompatible"],
    ["^1.4", "1.4.9", "compatible"],
    ["^0.3", "0.3.2", "compatible"],
    ["^0.3", "0.4.0", "incompatible"],
    ["^0.4", "0.3.0", "incompatible"],
  ])("range %s on host %s is %s", (apiRange, host, status) => {
    expect(parseManifest(manifest({ apiRange }), host).status).toBe(status);
  });

  it("fails a contribution id without the module prefix", () => {
    invalid(
      manifest({ contributes: { commands: ["rockett.cam.a", "acme.run"] } }),
      /contributes\.commands\.1 acme\.run must start with rockett\.cam\./,
    );
  });

  it("fails a setting outside plugin.<moduleId>.*", () => {
    invalid(
      manifest({ contributes: { settings: ["rockett.cam.units"] } }),
      /contributes\.settings\.0 rockett\.cam\.units must start with plugin\.rockett\.cam\./,
    );
  });

  it.each(["enabled", "hidden", "laser.enabled"])(
    "fails a setting a host owns: plugin.rockett.cam.%s",
    (name) => {
      invalid(
        manifest({
          contributes: { settings: [`plugin.rockett.cam.${name}`] },
        }),
        new RegExp(
          `contributes\\.settings\\.0 plugin\\.rockett\\.cam\\.${name.replace(".", "\\.")} is a host setting`,
        ),
      );
    },
  );

  it("fails a missing licence", () => {
    const { licence: _, ...rest } = manifest();
    invalid(rest, /licence/);
  });

  it.each([
    [{ apiRange: ">=1.0" }, /apiRange/],
    [{ apiRange: "^1.2.3" }, /apiRange/],
    [{ licence: "my own terms" }, /licence/],
    [{ manifestVersion: 2 }, /manifestVersion/],
    [{ id: "Rockett.Cam" }, /id/],
    [{ id: "design.extra" }, /design\.extra uses core namespace design/],
    [{ id: "b" }, /manifest\.id b would read as a core body id/],
  ])("fails %o", (over, message) => {
    invalid(manifest(over), message);
  });
});
