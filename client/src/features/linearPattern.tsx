import * as THREE from "three";
import {
  arrow,
  bodyCenter,
  type FeatureHandleDefinition,
  type HandleInput,
} from "../three/featureHandles";
import { meshOf } from "../three/meshes";
import { newId, type LinearPatternFeature } from "@rockett/shared";
import {
  AxisField,
  CheckField,
  LengthField,
  NumField,
  SelInfo,
} from "../components/form/fields";
import { bodies, clearInput, type PickInput } from "../commands/featureCommand";
import { useSetting } from "../settings";
import { useStore } from "../store";
import {
  axisMissing,
  axisParams,
  axisSelection,
  bodyIds,
  bodyPicks,
  edgeRefs,
  num,
  type AxisParams,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type LinearPatternParams = InputParams<
  Pick<LinearPatternFeature, "id" | "name" | "count" | "spacing" | "combine">
> &
  AxisParams;

function patternDirection(input: HandleInput): THREE.Vector3 | null {
  const { params, selection } = input;
  const edge = selection.find((s) => s.kind === "edge");
  if ((params.axisSource ?? "origin") === "edge") {
    if (edge?.kind !== "edge") return null;
    const body = input.bodies.find((b) => b.bodyId === edge.bodyId);
    const pl = (body && meshOf(body))?.edges.find(
      (e) => e.name === edge.edgeName,
    )?.polyline;
    if (!pl || pl.length < 6) return null;
    const n = pl.length;
    return new THREE.Vector3(
      pl[n - 3]! - pl[0]!,
      pl[n - 2]! - pl[1]!,
      pl[n - 1]! - pl[2]!,
    ).normalize();
  }
  const axis: string = params.axis ?? "X";
  return new THREE.Vector3(
    axis === "X" ? 1 : 0,
    axis === "Y" ? 1 : 0,
    axis === "Z" ? 1 : 0,
  );
}

const handle = {
  param: "spacing",
  fallback: 20,
  signed: true,
  place: (input) => {
    const origin = bodyCenter(input);
    const axis = patternDirection(input);
    return arrow(origin && axis && { origin, axis });
  },
} satisfies FeatureHandleDefinition<LinearPatternParams>;

const direction: PickInput = {
  key: "direction",
  providers: ["design.edge", "design.originAxis"],
  one: true,
  straight: true,
};

function LinearPatternForm({
  params,
  setParams,
}: FeatureFormProps<LinearPatternParams>) {
  const units = useSetting("units.length");
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <SelInfo
        label="Direction edge"
        input="direction"
        picks={selection.filter((x) => x.kind === "edge")}
        hint={
          axisMissing(params, selection, document)
            ? "Pick a direction"
            : "click a body edge, or pick X/Y/Z"
        }
      />
      <AxisField
        label="Direction"
        defaultAxis="X"
        edgeLabel="Selected edge"
        axisSource={params.axisSource}
        axis={params.axis}
        onChange={(patch) => {
          setParams(patch);
          clearInput("direction");
        }}
      />
      <NumField
        label="Quantity"
        value={num(params, "count", 3)}
        onChange={(v) => setParams({ count: v })}
        bind="/count"
        int
      />
      <LengthField
        label="Spacing"
        units={units}
        autoFocus
        value={num(params, handle.param, handle.fallback)}
        onChange={(v) => setParams({ spacing: v })}
        bind="/spacing"
      />
      <CheckField
        label="Join instances"
        value={!!(params.combine ?? false)}
        onChange={(v) => setParams({ combine: v })}
      />
    </>
  );
}

export const linearPattern: FeatureUI<
  LinearPatternFeature,
  LinearPatternParams
> = {
  type: "linearPattern",
  handle,
  initialParams: {},
  icon: "⋮⋮",
  title: "Rectangular Pattern",
  group: "pattern",
  picks: [bodies, direction],
  Form: LinearPatternForm,
  build: (params, selection) => {
    const ids = bodyIds(selection);
    if (ids.length === 0) return { error: "Select bodies to pattern" };
    const [edge] = edgeRefs(selection);
    const onEdge = params.axisSource === "edge";
    if (onEdge && !edge) return { error: "Pick a direction" };
    return {
      id: params.id ?? newId("lpat"),
      type: "linearPattern",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      direction:
        onEdge && edge
          ? { kind: "edge", edge }
          : { kind: "axis", axis: params.axis ?? "X" },
      count: Math.round(num(params, "count", 3)),
      spacing: num(params, handle.param, handle.fallback),
      combine: !!(params.combine ?? false),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      count: f.count,
      spacing: f.spacing,
      combine: f.combine,
      ...axisParams(f.direction, "X"),
    },
    selection: [...bodyPicks(f.bodies), ...axisSelection(f.direction)],
  }),
};

registerFeatureUI(linearPattern);
