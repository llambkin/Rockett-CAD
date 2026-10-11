import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FilletFeature } from "@rockett/shared";
import { fillet } from "./fillet";
import { createFeatureInputs } from "./registry";

const original: FilletFeature = {
  id: "fillet-input",
  type: "fillet",
  filletType: "equalDistance",
  name: "Fillet",
  suppressed: false,
  radius: 2.5,
  tangentChain: false,
  edges: [{ kind: "edge", bodyId: "body-input", edgeName: "edge-input" }],
};

describe("typed Fillet inputs", () => {
  it.each([
    ["equalDistance", ["Type", "Radius (mm)"]],
    ["twoDistances", ["Type", "Distance 1 (mm)", "Distance 2 (mm)", "Flip"]],
    ["variableRadius", ["Type", "Start radius (mm)", "End radius (mm)"]],
  ] as const)("shows the %s fields", (filletType, labels) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createFeatureInputs(fillet, { filletType }).renderForm(() => {}),
    );
    expect(
      [...host.querySelectorAll("label.field > span")]
        .map((span) => span.textContent)
        .filter((text) => text !== "Tangent chain"),
    ).toEqual(labels);
  });

  it("switching a prefilled type builds only the new type's fields", () => {
    const two: FilletFeature = {
      ...original,
      filletType: "twoDistances",
      distance2: 4,
      flip: true,
    };
    const { params, selection } = fillet.prefill!(two);
    expect(createFeatureInputs(fillet, params).build(selection)).toEqual(two);
    expect(
      createFeatureInputs(fillet, {
        ...params,
        filletType: "equalDistance",
      }).build(selection),
    ).toEqual(original);
    expect(
      createFeatureInputs(fillet, {
        ...fillet.prefill!(original).params,
        filletType: "twoDistances",
      }).build(selection),
    ).toEqual({
      ...original,
      filletType: "twoDistances",
      distance2: 2.5,
      flip: false,
    });
  });
});

const edge = (edgeName: string) => ({
  kind: "edge" as const,
  bodyId: "body-input",
  edgeName,
});

const labels = (params: object) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createFeatureInputs(fillet, params).renderForm(() => {}),
  );
  return [...host.querySelectorAll("label.field > span, button.btn")].map(
    (node) => node.textContent,
  );
};

describe("Fillet sets", () => {
  const twoSets: FilletFeature = {
    ...original,
    radius: 1,
    sets: [{ edges: [edge("edge-two")], radius: 3 }],
  };

  it("a prefilled fillet with two sets builds back from either active set", () => {
    const { params, selection } = fillet.prefill!(twoSets);
    expect(params).toMatchObject({ activeSet: 0, radius: 1 });
    expect(createFeatureInputs(fillet, params).build(selection)).toEqual(
      twoSets,
    );
    expect(
      createFeatureInputs(fillet, { ...params, activeSet: 1, radius: 3 }).build(
        [{ kind: "edge", bodyId: "body-input", edgeName: "edge-two" }],
      ),
    ).toEqual(twoSets);
    expect(
      createFeatureInputs(fillet, { ...params, activeSet: 1, radius: 4 }).build(
        [{ kind: "edge", bodyId: "body-input", edgeName: "edge-three" }],
      ),
    ).toEqual({
      ...twoSets,
      sets: [{ edges: [edge("edge-three")], radius: 4 }],
    });
  });

  it("refuses an empty set, set 1 included, and two distances on several sets", () => {
    const { params, selection } = fillet.prefill!(twoSets);
    const sets = [...params.sets!, { edges: [], radius: 2 }];
    expect(
      createFeatureInputs(fillet, { ...params, sets }).build(selection),
    ).toEqual({ error: "Select an edge, face or feature in set 3" });
    expect(
      createFeatureInputs(fillet, {
        ...params,
        sets: [{ edges: [], radius: 1 }, ...params.sets!.slice(1)],
        activeSet: 1,
      }).build([{ kind: "edge", bodyId: "body-input", edgeName: "edge-two" }]),
    ).toEqual({ error: "Select an edge, face or feature in set 1" });
    expect(
      createFeatureInputs(fillet, {
        ...params,
        filletType: "twoDistances",
      }).build(selection),
    ).toEqual({
      error: "Only equal distance takes several sets: remove the other sets",
    });
  });

  it("shows Set and Remove set only for several sets, and Add set only for equal distance", () => {
    expect(labels({})).toEqual(["Add set", "Type", "Radius (mm)"]);
    expect(labels(fillet.prefill!(twoSets).params)).toEqual([
      "Set",
      "Add set",
      "Remove set",
      "Type",
      "Radius (mm)",
    ]);
    expect(labels({ filletType: "twoDistances" })).not.toContain("Add set");
    expect(labels({ filletType: "variableRadius" })).not.toContain("Add set");
  });
});

const face = (faceName: string) => ({
  kind: "face" as const,
  bodyId: "body-input",
  faceName,
});

describe("Rule and variable fillets", () => {
  const ruled: FilletFeature = {
    ...original,
    edges: [],
    faces: [face("sides")],
    betweenFaces: [face("top")],
    betweenFeatures: ["boss"],
  };

  it("a prefilled rule fillet builds back, and Between picks become its rule", () => {
    const { params, selection } = fillet.prefill!(ruled);
    expect(params.between).toEqual([
      { kind: "face", bodyId: "body-input", faceName: "top" },
      { kind: "feature", featureId: "boss" },
    ]);
    expect(createFeatureInputs(fillet, params).build(selection)).toEqual(ruled);
    expect(
      createFeatureInputs(fillet, {
        ...fillet.prefill!(original).params,
        between: [{ kind: "face", bodyId: "body-input", faceName: "top" }],
      }).build([{ kind: "face", bodyId: "body-input", faceName: "sides" }]),
    ).toEqual({
      ...original,
      edges: [],
      faces: [face("sides")],
      betweenFaces: [face("top")],
    });
  });

  it("a variable fillet builds back and drops its end radius for another type", () => {
    const variable: FilletFeature = {
      ...original,
      filletType: "variableRadius",
      radius: 1,
      endRadius: 3,
    };
    const { params, selection } = fillet.prefill!(variable);
    expect(createFeatureInputs(fillet, params).build(selection)).toEqual(
      variable,
    );
    expect(
      createFeatureInputs(fillet, {
        ...params,
        filletType: "equalDistance",
      }).build(selection),
    ).toEqual({ ...original, radius: 1 });
  });
});
