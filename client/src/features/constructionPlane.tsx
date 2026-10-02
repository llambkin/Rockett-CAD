import {
  arrow,
  planeRay,
  type HandleInput,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import {
  newId,
  type AxisRef,
  type ConstructionPlaneFeature,
  type PlaneRef,
  type PointRef,
} from "@rockett/shared";
import {
  AngleField,
  AxisField,
  CheckField,
  LengthField,
  SelInfo,
  SelectField,
} from "../components/form/fields";
import {
  axis,
  clearInput,
  planar,
  type PickInput,
} from "../commands/featureCommand";
import { useStore, type Selection } from "../store";
import { useSetting } from "../settings";
import {
  type AxisParams,
  axisHint,
  axisMissing,
  axisParams,
  axisPicks,
  axisRef,
  axisSelection,
  num,
} from "./inputs";
import {
  registerFeatureUI,
  type InputParams,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

export type PlaneParams = InputParams<{
  method: ConstructionPlaneFeature["method"]["kind"];
  distance: number;
  offset: number;
  angle: number;
  flip: boolean;
}> &
  AxisParams;

function offsetPlaneRay(input: HandleInput) {
  if ((input.params.method ?? "offset") !== "offset") return null;
  const ray = planeRay(input);
  if (ray && input.params.flip) ray.axis.negate();
  return ray;
}

const handle = {
  param: "distance",
  fallback: 10,
  signed: true,
  place: (input) => arrow(offsetPlaneRay(input)),
} satisfies FeatureHandleDefinition<PlaneParams>;

type Method = ConstructionPlaneFeature["method"];

const OFFSET_TAKES_ONE = "Offset takes one reference; remove the extra one";

const planes = planar("plane", false);
const points: PickInput = {
  key: "points",
  providers: ["design.vertex", "sketch.point"],
};
const lines: PickInput = {
  key: "lines",
  providers: ["design.edge", "sketch.entity", "design.originAxis"],
  straight: true,
};

const PLANE_INPUTS: Record<Method["kind"], readonly PickInput[]> = {
  offset: [planes],
  midplane: [planes],
  angle: [axis, planar("plane", true)],
  threePoints: [points],
  twoEdges: [lines],
};

const methodOf = (params: PlaneParams): Method["kind"] =>
  params.method ?? "offset";

const refsOf = (selection: Selection[]) =>
  selection.flatMap((x): PlaneRef[] =>
    x.kind === "plane"
      ? [x.ref]
      : x.kind === "face"
        ? [{ kind: "face", face: { ...x } }]
        : [],
  );

function PlaneForm({ params, setParams }: FeatureFormProps<PlaneParams>) {
  const units = useSetting("units.length");
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.document);
  const method = methodOf(params);
  const refs = refsOf(selection);
  const flipField = (
    <CheckField
      label="Flip"
      value={!!(params.flip ?? false)}
      onChange={(v) => setParams({ flip: v })}
    />
  );
  return (
    <>
      <SelectField
        label="Method"
        value={method}
        options={[
          ["offset", "Offset"],
          ["midplane", "Midplane"],
          ["angle", "At angle"],
          ["threePoints", "3 points"],
          ["twoEdges", "2 edges"],
        ]}
        onChange={(v) => setParams({ method: v })}
      />
      {method === "offset" && (
        <>
          <SelInfo
            label="Reference plane"
            input="plane"
            hint="click a plane or planar face"
          />
          {refs.length > 1 && (
            <div className="field-hint">{OFFSET_TAKES_ONE}</div>
          )}
          <LengthField
            label="Offset"
            units={units}
            autoFocus
            value={num(params, handle.param, handle.fallback)}
            onChange={(v) => setParams({ distance: v })}
            bind="/method/distance"
          />
          {flipField}
        </>
      )}
      {method === "midplane" && (
        <>
          <SelInfo
            label="Planes"
            input="plane"
            hint="click two planes or planar faces"
          />
          <LengthField
            label="Offset"
            units={units}
            value={num(params, "offset", 0)}
            onChange={(v) => setParams({ offset: v })}
            bind="/method/offset"
          />
          {flipField}
        </>
      )}
      {method === "angle" && (
        <>
          <SelInfo
            label="Axis"
            input="axis"
            picks={axisPicks(selection, doc)}
            hint={axisHint(axisMissing(params, selection, doc))}
          />
          <AxisField
            axisSource={params.axisSource}
            axis={params.axis}
            onChange={(patch) => {
              setParams(patch);
              clearInput("axis");
            }}
          />
          <SelInfo
            label="Reference plane"
            input="plane"
            hint="click a plane or planar face"
          />
          <AngleField
            label="Angle"
            value={num(params, "angle", 90)}
            onChange={(v) => setParams({ angle: v })}
            bind="/method/angle"
          />
        </>
      )}
      {method === "threePoints" && (
        <SelInfo
          label="Points"
          input="points"
          hint="click three vertices or sketch points"
        />
      )}
      {method === "twoEdges" && (
        <SelInfo
          label="Edges"
          input="lines"
          hint="click two straight edges in one plane"
        />
      )}
    </>
  );
}

function planeMethod(
  params: PlaneParams,
  selection: Selection[],
): Method | { error: string } {
  const refs = refsOf(selection);
  const flip = !!(params.flip ?? false);
  switch (methodOf(params)) {
    case "offset":
      if (refs.length === 0) return { error: "Select a base plane or face" };
      if (refs.length !== 1) return { error: OFFSET_TAKES_ONE };
      return {
        kind: "offset",
        base: refs[0]!,
        distance: num(params, handle.param, handle.fallback),
        ...(flip && { flip }),
      };
    case "midplane": {
      if (refs.length !== 2)
        return { error: "Select two references for a midplane" };
      const offset = num(params, "offset", 0);
      return {
        kind: "midplane",
        a: refs[0]!,
        b: refs[1]!,
        ...(offset !== 0 && { offset }),
        ...(flip && { flip }),
      };
    }
    case "angle": {
      if (refs.length !== 1)
        return { error: "Select a reference plane or face" };
      const axisOf = axisRef(params, selection, useStore.getState().document);
      if (!axisOf) return { error: "Pick an axis" };
      return {
        kind: "angle",
        axis: axisOf,
        base: refs[0]!,
        angle: num(params, "angle", 90),
      };
    }
    case "threePoints": {
      const picked = selection.flatMap((x): PointRef[] =>
        x.kind === "vertex" || x.kind === "sketchPoint" ? [{ ...x }] : [],
      );
      if (picked.length !== 3) return { error: "Select three points" };
      return {
        kind: "threePoints",
        points: [picked[0]!, picked[1]!, picked[2]!],
      };
    }
    case "twoEdges": {
      const picked = selection.flatMap((x): AxisRef[] => {
        if (x.kind === "edge") return [{ kind: "edge", edge: { ...x } }];
        if (x.kind === "axis") return [{ kind: "originAxis", axis: x.axis }];
        return x.kind === "sketchEntity"
          ? [{ kind: "sketchLine", sketchId: x.sketchId, entityId: x.entityId }]
          : [];
      });
      if (picked.length !== 2) return { error: "Select two straight edges" };
      return { kind: "twoEdges", a: picked[0]!, b: picked[1]! };
    }
  }
}

const plane = (ref: PlaneRef, label: string): Selection => ({
  kind: "plane",
  ref,
  label,
});

function prefillMethod(m: Method) {
  switch (m.kind) {
    case "offset":
      return {
        params: { distance: m.distance, flip: m.flip },
        selection: [plane(m.base, "Base")],
      };
    case "midplane":
      return {
        params: { offset: m.offset, flip: m.flip },
        selection: [plane(m.a, "A"), plane(m.b, "B")],
      };
    case "angle":
      return {
        params: { angle: m.angle, ...axisParams(m.axis) },
        selection: [...axisSelection(m.axis), plane(m.base, "Base")],
      };
    case "threePoints":
      return {
        params: {},
        selection: m.points.map((point): Selection => ({ ...point })),
      };
    case "twoEdges":
      return {
        params: {},
        selection: [m.a, m.b].flatMap((line): Selection[] =>
          line.kind === "originAxis"
            ? [{ kind: "axis", axis: line.axis }]
            : axisSelection(line),
        ),
      };
  }
}

const constructionPlane: FeatureUI<ConstructionPlaneFeature, PlaneParams> = {
  type: "constructionPlane",
  handle,
  icon: "▱",
  title: "Construction Plane",
  group: "construct",
  picks: [planes, axis, points, lines],
  initialParams: {},
  picksFor: (params) => PLANE_INPUTS[methodOf(params)],
  Form: PlaneForm,
  build: (params, selection) => {
    const method = planeMethod(params, selection);
    if ("error" in method) return method;
    return {
      id: params.id ?? newId("plane"),
      type: "constructionPlane",
      name: params.name ?? "",
      suppressed: false,
      method,
    };
  },
  prefill: (f) => {
    const { params, selection } = prefillMethod(f.method);
    return {
      params: { id: f.id, name: f.name, method: f.method.kind, ...params },
      selection,
    };
  },
};

registerFeatureUI(constructionPlane);
