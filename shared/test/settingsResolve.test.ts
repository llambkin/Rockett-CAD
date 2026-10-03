import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
  defineSetting,
  registerSettings,
  resolveSettings,
  SETTINGS,
  validateSettingValue,
  type SettingLayers,
  type SettingScope,
} from "../src/index.js";

const step = defineSetting({
  key: "resolve.step",
  label: "Step",
  scopes: ["app", "user", "project"],
  section: "user",
  default: 15,
  schema: Type.Integer({ minimum: 1, maximum: 90 }),
});

const tolerance = defineSetting({
  key: "resolve.tolerance",
  label: "Tolerance",
  scopes: ["app", "user"],
  section: "user",
  default: 7,
  schema: Type.Integer({ minimum: 2, maximum: 20 }),
});

const mode = defineSetting({
  key: "resolve.mode",
  label: "Mode",
  scopes: ["project"],
  section: "project",
  default: "a",
  schema: Type.Union([Type.Literal("a"), Type.Literal("b")]),
});

registerSettings([step, tolerance, mode]);

describe("resolveSettings", () => {
  it("gives every registered key its default with no layers", () => {
    const { values, errors } = resolveSettings({});
    expect(errors).toEqual([]);
    expect(Object.keys(values)).toEqual([...SETTINGS.keys()]);
    expect(values["resolve.step"]).toEqual({ value: 15, source: "default" });
    expect(values["resolve.mode"]).toEqual({ value: "a", source: "default" });
  });

  it("takes default, then app, then user, then project", () => {
    const layers: SettingLayers = {
      app: { "resolve.step": 20, "resolve.tolerance": 9 },
      user: { "resolve.step": 30, "resolve.tolerance": 11 },
      project: { "resolve.step": 45 },
    };
    const { values } = resolveSettings(layers);
    expect(values["resolve.step"]).toEqual({ value: 45, source: "project" });
    expect(values["resolve.tolerance"]).toEqual({ value: 11, source: "user" });
    expect(
      resolveSettings({ app: { "resolve.step": 20 } }).values["resolve.step"],
    ).toEqual({ value: 20, source: "app" });
  });

  it("ignores a layer the key's scopes do not allow", () => {
    const { values, errors } = resolveSettings({
      user: { "resolve.tolerance": 12, "resolve.mode": "b" },
      project: { "resolve.tolerance": 3 },
    });
    expect(values["resolve.tolerance"]).toEqual({ value: 12, source: "user" });
    expect(values["resolve.mode"]).toEqual({ value: "a", source: "default" });
    expect(errors).toEqual([]);
  });

  it("skips and reports an invalid stored value without throwing", () => {
    const { values, errors } = resolveSettings({
      app: { "resolve.step": 20 },
      user: { "resolve.step": 91 },
      project: { "resolve.step": "x", "resolve.mode": "b" },
    });
    expect(values["resolve.step"]).toEqual({ value: 20, source: "app" });
    expect(values["resolve.mode"]).toEqual({ value: "b", source: "project" });
    expect(errors).toMatchObject([
      { scope: "user", code: "value", key: "resolve.step" },
      { scope: "project", code: "value", key: "resolve.step" },
    ]);
  });

  it("ignores unknown keys and leaves every layer unchanged", () => {
    const user = { "plugin.gone.width": 4, "resolve.step": 30 };
    const before = structuredClone(user);
    const { values, errors } = resolveSettings({ user });
    expect(values).not.toHaveProperty("plugin.gone.width");
    expect(values["resolve.step"]).toEqual({ value: 30, source: "user" });
    expect(errors).toEqual([]);
    expect(user).toEqual(before);
  });

  it("never lets an inherited property stand in for a stored value", () => {
    const user = Object.create({ "resolve.step": 30 }) as Record<
      string,
      unknown
    >;
    expect(resolveSettings({ user }).values["resolve.step"]).toEqual({
      value: 15,
      source: "default",
    });
  });

  it("resolves only values that pass validateSettingValue", () => {
    let seed = 0x5e7002;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const candidates: unknown[] = [
      0,
      1,
      2,
      7,
      20,
      21,
      45,
      90,
      91,
      -3,
      2.5,
      "a",
      "b",
      "c",
      "",
      null,
      true,
      [],
      {},
      Number.NaN,
    ];
    const pick = () => candidates[Math.floor(next() * candidates.length)];
    const keys = [...SETTINGS.keys(), "plugin.gone.width"];
    const scopes: SettingScope[] = ["app", "user", "project"];
    for (let run = 0; run < 500; run++) {
      const layers: SettingLayers = {};
      for (const scope of scopes) {
        if (next() < 0.2) continue;
        const layer: Record<string, unknown> = {};
        for (const key of keys) if (next() < 0.6) layer[key] = pick();
        layers[scope] = layer;
      }
      const { values } = resolveSettings(layers);
      expect(Object.keys(values)).toEqual([...SETTINGS.keys()]);
      for (const [key, { value, source }] of Object.entries(values)) {
        const scope =
          source === "default" ? SETTINGS.get(key)!.scopes[0] : source;
        expect(validateSettingValue(key, scope, value)).toBeUndefined();
        if (source !== "default") expect(layers[source]![key]).toBe(value);
      }
    }
  });
});
