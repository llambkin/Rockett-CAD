import { expect, expectTypeOf, it } from "vitest";
import { Type } from "typebox";
import { createEmptyDocument, type ExtensionFeature } from "./model.js";
import { registerExtensionSpec } from "./featureSpec.js";
import {
  FEATURE_INPUT_MAX_DEPTH,
  resolvedFeatureInputs,
} from "./featureInputs.js";
import { MODULE_DATA_MAX_BYTES } from "./units.js";

const feature: ExtensionFeature = {
  id: "input",
  name: "Input",
  type: "probe.json.input",
  suppressed: false,
  version: 1,
  params: { linkId: "link" },
};
const doc = createEmptyDocument("json-input", "Input");
const hash = "0".repeat(64);

it("infers typed immutable params and detaches canonical JSON identity and assets", () => {
  const original = { z: [1, null, "x"], a: { finite: 2 } };
  const dispose = registerExtensionSpec({
    type: feature.type,
    label: "Input",
    version: 1,
    params: Type.Object({ linkId: Type.String() }),
    resolveInputs({ params }) {
      expectTypeOf(params.linkId).toEqualTypeOf<string>();
      expect(Object.isFrozen(params)).toBe(true);
      return { identity: original, assets: [hash, hash] };
    },
  });
  try {
    const result = resolvedFeatureInputs(feature, doc)!;
    expect(result).toEqual({
      identity: { a: { finite: 2 }, z: [1, null, "x"] },
      assets: [hash],
    });
    expect(Object.keys(result.identity!)).toEqual(["a", "z"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.identity)).toBe(true);
    expect(Object.isFrozen(result.assets)).toBe(true);
    original.z[0] = 4;
    expect(result.identity).toEqual({ a: { finite: 2 }, z: [1, null, "x"] });
    expect(
      resolvedFeatureInputs(feature, structuredClone(doc))!.identity,
    ).toEqual(original);
  } finally {
    dispose();
  }
  expect(resolvedFeatureInputs(feature, doc)).toBeUndefined();
});

it.each<[string, () => unknown]>([
  ["nonfinite", () => Infinity],
  ["undefined", () => ({ no: undefined })],
  ["bigint", () => 1n],
  ["date", () => new Date(0)],
  [
    "cycle",
    () => {
      const cycle: unknown[] = [];
      cycle.push(cycle);
      return cycle;
    },
  ],
  [
    "sparse",
    () => {
      const sparse: unknown[] = [];
      sparse[2] = 1;
      return sparse;
    },
  ],
  [
    "accessor",
    () =>
      Object.defineProperty({}, "getter", {
        enumerable: true,
        get() {
          throw new Error("getter executed");
        },
      }),
  ],
  [
    "deep",
    () => {
      let nested: unknown = 0;
      for (let i = 0; i <= FEATURE_INPUT_MAX_DEPTH; i++) nested = [nested];
      return nested;
    },
  ],
  ["large", () => "x".repeat(MODULE_DATA_MAX_BYTES)],
])("refuses %s resolver identity as bounded plain JSON", (_name, identity) => {
  const dispose = registerExtensionSpec({
    type: feature.type,
    label: "Input",
    version: 1,
    params: Type.Object({}),
    resolveInputs: () => ({ identity: identity() as never, assets: [] }),
  });
  try {
    expect(() => resolvedFeatureInputs(feature, doc)).toThrow(
      /module feature input/,
    );
  } finally {
    dispose();
  }
});

it("rejects non-JSON committed input before calling the resolver and never runs its getter", () => {
  let called = false;
  const dispose = registerExtensionSpec({
    type: feature.type,
    label: "Input",
    version: 1,
    params: Type.Object({}),
    resolveInputs: () => {
      called = true;
      return { identity: null, assets: [] };
    },
  });
  try {
    const extensions = {
      "probe.json": { version: 1, data: { bad: Number.NaN } },
    };
    expect(() => resolvedFeatureInputs(feature, { extensions })).toThrow(
      /JSON/,
    );
    expect(called).toBe(false);
  } finally {
    dispose();
  }
});

it("rejects invalid content-hash assets", () => {
  const dispose = registerExtensionSpec({
    type: feature.type,
    label: "Input",
    version: 1,
    params: Type.Object({}),
    resolveInputs: () => ({ identity: null, assets: ["../../foreign"] }),
  });
  try {
    expect(() => resolvedFeatureInputs(feature, doc)).toThrow(/content-hash/);
  } finally {
    dispose();
  }
});

it("isolates resolver input and byte budgets from unrelated unknown extension data", () => {
  const extensions = {
    unknown: { version: 9, data: "x".repeat(MODULE_DATA_MAX_BYTES + 1) },
    "probe.json": { version: 1, data: { number: 4 } },
  };
  const dispose = registerExtensionSpec({
    type: feature.type,
    label: "Input",
    version: 1,
    params: Type.Object({}),
    resolveInputs({ extensions: scoped }) {
      expect(Object.keys(scoped)).toEqual(["probe.json"]);
      expect(scoped["probe.json"]).not.toBe(extensions["probe.json"]);
      return { identity: scoped["probe.json"]!.data as never, assets: [] };
    },
  });
  try {
    expect(resolvedFeatureInputs(feature, { extensions })).toEqual({
      identity: { number: 4 },
      assets: [],
    });
    expect(extensions.unknown.data.length).toBe(MODULE_DATA_MAX_BYTES + 1);
    expect(Object.isFrozen(extensions)).toBe(false);
  } finally {
    dispose();
  }
});
