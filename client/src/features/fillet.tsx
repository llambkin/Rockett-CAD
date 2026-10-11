import {
  arrow,
  edgeRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import {
  FILLET_TYPES,
  newId,
  withFilletSets,
  filletSets,
  type FilletFeature,
  type FilletSet,
} from "@rockett/shared";
import { SelectField, SelInfo } from "../components/form/fields";
import {
  blendPicks,
  featureParams,
  setFeatureParams,
  type PickInput,
} from "../commands/featureCommand";
import { useStore, type Selection } from "../store";
import { boundText } from "../components/form/expressionField";
import { faceRefs, keptRefs, num, storedFeature } from "./inputs";
import { refsOf } from "../selection/kinds";
import {
  blendHint,
  blendSelection,
  blendSources,
  refuseVertex,
} from "./blendPicks";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";
import { TangentChainField } from "./tangentChain";
import { BlendSizeFields } from "./blendSize";

export type FilletParams = InputParams<
  Pick<
    FilletFeature,
    | "id"
    | "name"
    | "radius"
    | "tangentChain"
    | "filletType"
    | "distance2"
    | "endRadius"
    | "flip"
    | "sets"
  > & { activeSet: number; between: Selection[] }
>;

const handle = {
  param: "radius",
  fallback: 2,
  signed: false,
  place: (input) => arrow(edgeRay(input.bodies, first(input, "edge"))),
} satisfies FeatureHandleDefinition<FilletParams>;

function sizes(params: FilletParams) {
  const filletType = params.filletType ?? "equalDistance";
  const radius = num(params, handle.param, handle.fallback);
  if (filletType === "equalDistance") return { filletType, radius };
  if (filletType === "variableRadius")
    return { filletType, radius, endRadius: num(params, "endRadius", radius) };
  return {
    filletType,
    radius,
    distance2: num(params, "distance2", radius),
    flip: params.flip ?? false,
  };
}

const between = {
  key: "between",
  providers: ["design.face", "design.feature"],
  optional: true,
  param: {
    read: (s) => featureParams(s).between ?? [],
    write: (next) => setFeatureParams({ between: next }),
  },
} satisfies PickInput;

const ruleSelection = (set: FilletSet) =>
  blendSelection({
    edges: [],
    faces: set.betweenFaces ?? [],
    features: set.betweenFeatures ?? [],
  });

function rule(params: FilletParams) {
  const picks = params.between ?? [];
  const stored = storedFeature(params.id);
  return {
    ...keptRefs("betweenFaces", faceRefs(picks), stored),
    ...keptRefs("betweenFeatures", refsOf(picks, "feature"), stored),
  };
}

const radiusPath = (set: number) =>
  set === 0 ? "/radius" : `/sets/${set - 1}/radius`;

const activeOf = (params: FilletParams) => num(params, "activeSet", 0);

function liveSets(params: FilletParams, selection: Selection[]): FilletSet[] {
  const picks = blendSources(params.id, selection);
  const live = {
    ...("error" in picks ? { edges: [] } : picks),
    ...rule(params),
    radius: sizes(params).radius,
  };
  const sets = params.sets?.length ? params.sets : [live];
  return sets.map((set, i) => (i === activeOf(params) ? live : set));
}

function showSet(
  setParams: (patch: Partial<FilletParams>) => void,
  sets: FilletSet[],
  active: number,
) {
  const set = sets[active]!;
  setParams({
    sets,
    activeSet: active,
    radius: set.radius,
    between: ruleSelection(set),
  });
  useStore.getState().setSelection(blendSelection(set));
}

function FilletSets({ params, setParams }: FeatureFormProps<FilletParams>) {
  const active = activeOf(params);
  const count = Math.max(params.sets?.length ?? 1, 1);
  const sets = () => liveSets(params, useStore.getState().selection);
  const remove = () => {
    const expressions = { ...featureParams().expressions };
    for (let i = active; i < count; i++)
      expressions[radiusPath(i)] =
        (i + 1 < count
          ? boundText(useStore.getState(), radiusPath(i + 1))
          : undefined) ?? null;
    const kept = sets().filter((_, i) => i !== active);
    setFeatureParams({ expressions });
    showSet(setParams, kept, Math.max(active - 1, 0));
  };
  return (
    <>
      {count > 1 && (
        <SelectField
          label="Set"
          value={String(active)}
          options={Array.from({ length: count }, (_, i): [string, string] => [
            String(i),
            `Set ${i + 1}`,
          ])}
          onChange={(v) => showSet(setParams, sets(), Number(v))}
        />
      )}
      {sizes(params).filletType === "equalDistance" && (
        <button
          type="button"
          className="btn"
          onClick={() =>
            showSet(
              setParams,
              [...sets(), { edges: [], radius: sizes(params).radius }],
              count,
            )
          }
        >
          Add set
        </button>
      )}
      {count > 1 && (
        <button type="button" className="btn" onClick={remove}>
          Remove set
        </button>
      )}
    </>
  );
}

function FilletForm({ params, setParams }: FeatureFormProps<FilletParams>) {
  const { filletType, radius, ...second } = sizes(params);
  const active = activeOf(params);
  return (
    <>
      <FilletSets params={params} setParams={setParams} />
      <SelInfo label="Edges" input="edges" hint={blendHint} />
      <SelInfo
        label="Between"
        input="between"
        hint="optional: faces or a feature the edges meet"
      />
      <TangentChainField params={params} setParams={setParams} />
      <BlendSizeFields
        key={active}
        types={FILLET_TYPES}
        size={{ type: filletType, size: radius, ...second }}
        label="Radius"
        bind={radiusPath(active)}
        onType={(v) => setParams({ filletType: v })}
        onSize={(v) => setParams({ radius: v })}
        setParams={setParams}
      />
    </>
  );
}

export const fillet: FeatureUI<FilletFeature, FilletParams> = {
  type: "fillet",
  handle,
  initialParams: {},
  icon: "◠",
  title: "Fillet",
  group: "modify",
  picks: [blendPicks, between],
  Form: FilletForm,
  build: (params, selection) => {
    const sets = liveSets(params, selection);
    const picks = blendSources(params.id, selection);
    if ("error" in picks && sets.length === 1) return picks;
    const empty = sets.findIndex((set) => blendSelection(set).length === 0);
    if (empty >= 0)
      return { error: `Select an edge, face or feature in set ${empty + 1}` };
    const [head, ...more] = sets;
    if (more.length > 0 && sizes(params).filletType !== "equalDistance")
      return {
        error: "Only equal distance takes several sets: remove the other sets",
      };
    const base: FilletFeature = {
      id: params.id ?? newId("fillet"),
      type: "fillet",
      name: params.name ?? "",
      suppressed: false,
      edges: [],
      ...sizes(params),
      tangentChain: params.tangentChain ?? true,
    };
    return {
      ...withFilletSets(base, [head!, ...more]),
      ...keptRefs("sets", more, storedFeature(params.id)),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      filletType: f.filletType,
      radius: f.radius,
      distance2: f.distance2,
      endRadius: f.endRadius,
      flip: f.flip,
      between: ruleSelection(f),
      tangentChain: f.tangentChain ?? false,
      ...(f.sets?.length && { sets: filletSets(f), activeSet: 0 }),
    },
    selection: blendSelection(f),
  }),
  onPick: refuseVertex(
    "Fillet rounds edges: pick the edges or faces at this corner",
  ),
};

registerFeatureUI(fillet);
