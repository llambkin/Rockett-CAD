import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
  defineSetting,
  moduleEnabledSetting,
  registerSettings,
  SETTINGS,
  SettingsError,
  validateSettingValue,
  type SettingOf,
  type SettingValue,
} from "../src/index.js";

const size = defineSetting({
  key: "plugin.demo.size",
  label: "Size",
  scopes: ["app", "user"],
  section: "plugin:demo",
  default: 7,
  schema: Type.Integer({ minimum: 2, maximum: 20 }),
});

const angles = defineSetting({
  key: "test.angles",
  label: "Angles",
  scopes: ["user", "project"],
  section: "user",
  default: [15],
  schema: Type.Array(Type.Number(), { maxItems: 3 }),
});

declare module "../src/settings.js" {
  interface SettingTypes {
    [size.key]: SettingOf<typeof size>;
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const typed: [
  Equal<SettingValue<"plugin.demo.size">, number>,
  Equal<SettingOf<typeof angles>, number[]>,
] = [true, true];

registerSettings([size, angles]);

function rejected(definitions: Parameters<typeof registerSettings>[0]) {
  try {
    registerSettings(definitions);
  } catch (err) {
    expect(err).toBeInstanceOf(SettingsError);
    return (err as SettingsError).errors.map(({ code, key }) => [code, key]);
  }
  throw new Error("registerSettings accepted the definitions");
}

const plain = (key: string) =>
  defineSetting({
    key,
    label: key,
    scopes: ["app"],
    section: "app",
    default: true,
    schema: Type.Boolean(),
  });

describe("registerSettings", () => {
  it("types values from the definition", () => {
    expect(typed).toEqual([true, true]);
  });

  it("registers a plugin definition under its own section", () => {
    expect(SETTINGS.get("plugin.demo.size")).toBe(size);
    expect(SETTINGS.get("plugin.demo.size")!.section).toBe("plugin:demo");
  });

  it("names a dotted module id's setting under that id's section", () => {
    const enabled = moduleEnabledSetting("acme.tools");
    registerSettings([enabled]);
    expect(SETTINGS.get("plugin.acme.tools.enabled")!.section).toBe(
      "plugin:acme.tools",
    );
    expect(validateSettingValue(enabled.key, "user", false)).toMatchObject({
      code: "scope",
    });
  });

  it("rejects a key that is already registered or repeated in the batch", () => {
    expect(rejected([{ ...size, label: "Again" }])).toEqual([
      ["duplicateKey", "plugin.demo.size"],
    ]);
    expect(rejected([plain("test.twice"), plain("test.twice")])).toEqual([
      ["duplicateKey", "test.twice"],
    ]);
  });

  it.each([
    "units",
    "Units.length",
    "units.Length",
    "units..length",
    "units.length.",
    "1units.length",
    "units.length-x",
    "units.len gth",
    "",
  ])("rejects the key %j", (key) => {
    expect(rejected([plain(key)])).toEqual([["badKey", key]]);
  });

  it("accepts keys of two or more camelCase segments", () => {
    registerSettings([plain("view.zoomStepTest"), plain("a.b2.cDe")]);
    expect(SETTINGS.has("view.zoomStepTest")).toBe(true);
    expect(SETTINGS.has("a.b2.cDe")).toBe(true);
  });

  it("rejects a default that fails its own schema", () => {
    const bad = { ...size, key: "plugin.demo.bad", default: 30 };
    expect(rejected([bad])).toEqual([["badDefault", "plugin.demo.bad"]]);
  });

  it.each([
    ["plugin.demo.other", "plugin:other"],
    ["plugin.demo.other", "user"],
    ["plugin.demo", "plugin:demo"],
    ["test.other", "plugin:demo"],
  ] as const)("rejects the key %s in section %s", (key, section) => {
    expect(rejected([{ ...plain(key), section }])).toEqual([["section", key]]);
  });

  it("registers nothing from a batch with any error", () => {
    rejected([plain("test.kept"), plain("Bad")]);
    expect(SETTINGS.has("test.kept")).toBe(false);
  });
});

describe("validateSettingValue", () => {
  it("accepts a valid value in an allowed scope", () => {
    expect(
      validateSettingValue("plugin.demo.size", "user", 12),
    ).toBeUndefined();
    expect(
      validateSettingValue("test.angles", "project", [1, 2]),
    ).toBeUndefined();
  });

  it("names an unknown key", () => {
    expect(validateSettingValue("plugin.gone.x", "user", 1)).toMatchObject({
      code: "unknownKey",
      key: "plugin.gone.x",
    });
  });

  it("names a scope outside the definition's scopes", () => {
    expect(
      validateSettingValue("plugin.demo.size", "project", 7),
    ).toMatchObject({ code: "scope", key: "plugin.demo.size" });
  });

  it("names a bad value with the key and path", () => {
    expect(validateSettingValue("plugin.demo.size", "app", 21)).toEqual({
      code: "value",
      key: "plugin.demo.size",
      message: "plugin.demo.size must be <= 20",
      path: "",
    });
    expect(validateSettingValue("test.angles", "user", [1, "x"])).toEqual({
      code: "value",
      key: "test.angles",
      message: "test.angles.1 must be number",
      path: "/1",
    });
  });
});
