import type {
  ExtrudeFeature,
  ExtrudeThin,
  SketchEntityRef,
} from "@rockett/shared";
import {
  CheckField,
  LengthField,
  SelectField,
  SelInfo,
} from "../components/form/fields";
import type { PickInput } from "../commands/featureCommand";
import { fromRef, refsOf } from "../selection/kinds";
import type { Selection } from "../store";
import { useSetting } from "../settings";
import { keptRefs, num } from "./inputs";
import type { FeatureFormProps, InputParams } from "./registry";

export type ThinParams = InputParams<{
  thin: boolean;
  wallLocation: ExtrudeThin["location"];
  wallThickness: number;
}>;

export const curves: PickInput = {
  key: "curves",
  providers: ["sketch.entity"],
  optional: true,
  noConstruction: true,
};

const curveRefs = (selection: Selection[]): SketchEntityRef[] => [
  ...new Map(
    refsOf(selection, "sketchEntity").map(({ sketchId, entityId }) => [
      `${sketchId}:${entityId}`,
      { kind: "sketchEntity" as const, sketchId, entityId },
    ]),
  ).values(),
];

export function ThinToggle({
  params,
  setParams,
}: FeatureFormProps<ThinParams>) {
  return (
    <>
      <CheckField
        label="Thin"
        value={!!params.thin}
        onChange={(v) => setParams({ thin: v })}
      />
      {params.thin && (
        <SelInfo
          label="Open curves"
          input="curves"
          hint="click sketch curves to wall along"
        />
      )}
    </>
  );
}

export function ThinFields({
  params,
  setParams,
}: FeatureFormProps<ThinParams>) {
  const units = useSetting("units.length");
  if (!params.thin) return null;
  return (
    <>
      <SelectField
        label="Wall location"
        value={params.wallLocation ?? "inside"}
        options={[
          ["inside", "Inside"],
          ["outside", "Outside"],
          ["centre", "Centre"],
        ]}
        onChange={(v) => setParams({ wallLocation: v })}
      />
      <LengthField
        label="Wall thickness"
        units={units}
        value={num(params, "wallThickness", 1)}
        onChange={(v) => setParams({ wallThickness: v })}
        bind="/thin/thickness"
      />
      <div className="field-hint">
        On open curves Inside is left of the first curve picked
      </div>
    </>
  );
}

export function thinPart(
  params: ThinParams,
  selection: Selection[],
  stored: object,
): Pick<ExtrudeFeature, "curves" | "thin"> | { error: string } {
  if (!params.thin) return {};
  const thickness = num(params, "wallThickness", 1);
  if (!(thickness > 0)) return { error: "Wall thickness must be positive" };
  return {
    ...keptRefs("curves", curveRefs(selection), stored),
    thin: { location: params.wallLocation ?? "inside", thickness },
  };
}

export const thinPrefill = (f: ExtrudeFeature) => ({
  params: {
    thin: !!f.thin,
    wallLocation: f.thin?.location ?? "inside",
    wallThickness: f.thin?.thickness ?? 1,
  },
  picks: (f.curves ?? []).map(({ sketchId, entityId }) =>
    fromRef("sketchEntity", { sketchId, entityId }),
  ),
});
