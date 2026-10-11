import { Vector3 } from "three";
import {
  arcAngles,
  newId,
  type SketchPoint,
  type SweepFeature,
  type Vec3,
} from "@rockett/shared";
import {
  OperationField,
  SelInfo,
  SelectField,
} from "../components/form/fields";
import {
  profiles,
  targets,
  featureParams,
  setFeatureParams,
  type PickInput,
} from "../commands/featureCommand";
import {
  autoOperation,
  movedCells,
  toolBase,
  toolOperation,
  turnedCells,
} from "../extrudeReach";
import { uv3 } from "../three/CadViewport";
import { useStore, type Selection } from "../store";
import { bodyTargets, profilePicks, profileRefs } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type SweepParams = InputParams<
  Pick<SweepFeature, "id" | "name" | "pathSketchId" | "operation" | "targets">
> & { autoOperation?: boolean | undefined };

const sketchPicks = (sketchId: string | undefined): Selection[] =>
  sketchId ? [{ kind: "sketch", sketchId }] : [];

const path: PickInput = {
  key: "path",
  providers: ["sketch.entity"],
  wholeSketch: true,
  one: true,
  noConstruction: true,
  param: {
    read: (s) => sketchPicks(featureParams(s).pathSketchId),
    write: (next) =>
      setFeatureParams({
        pathSketchId: next.flatMap((x) =>
          "sketchId" in x && typeof x.sketchId === "string" ? [x.sketchId] : [],
        )[0],
      }),
  },
};

function SweepForm({ params, setParams }: FeatureFormProps<SweepParams>) {
  const features = useStore((s) => s.document?.features);
  const sketches = (features ?? []).filter((f) => f.type === "sketch");
  return (
    <>
      <SelInfo label="Profile" input="profiles" hint="click a sketch region" />
      <SelectField
        label="Path sketch"
        value={params.pathSketchId ?? ""}
        options={[
          ["", "Choose"],
          ...sketches.map((s): [string, string] => [s.id, s.name]),
        ]}
        onChange={(v) => setParams({ pathSketchId: v })}
      />
      <SelInfo
        label="Path sketch"
        input="path"
        hint="click a curve of the path sketch, not a construction curve"
      />
      <OperationField />
    </>
  );
}

interface Curve {
  a: SketchPoint;
  b: SketchPoint;
  tangent: number;
  turn: number;
  center: SketchPoint | undefined;
}

function sweepCells(pathSketchId: string | undefined): Vec3[][] {
  const s = useStore.getState();
  const spine = s.evaluation?.sketches.find(
    (k) => k.featureId === pathSketchId,
  );
  const triangles = s.selection.flatMap((sel) =>
    sel.kind === "profile" ? (toolBase(sel)?.triangles ?? []) : [],
  );
  if (!spine || triangles.length === 0) return [];
  const { frame } = spine;
  const points = new Map<string, SketchPoint>();
  for (const e of spine.entities) if (e.kind === "point") points.set(e.id, e);
  const at = (p: SketchPoint) => uv3(frame, p.x, p.y);
  const curves = spine.entities.flatMap((e): Curve[] => {
    if (e.construction) return [];
    if (e.kind === "line") {
      const a = points.get(e.p1);
      const b = points.get(e.p2);
      if (!a || !b) return [];
      const tangent = Math.atan2(b.y - a.y, b.x - a.x);
      return [{ a, b, tangent, turn: 0, center: undefined }];
    }
    if (e.kind !== "arc") return [];
    const [a, b, center] = [e.start, e.end, e.center].map((id) =>
      points.get(id),
    );
    if (!a || !b || !center) return [];
    const { a0, a1 } = arcAngles({
      cx: center.x,
      cy: center.y,
      sx: a.x,
      sy: a.y,
      ex: b.x,
      ey: b.y,
    });
    return [{ a, b, tangent: a0 + Math.PI / 2, turn: a1 - a0, center }];
  });
  const middle = triangles
    .flat()
    .reduce((m, p) => m.add(new Vector3(...p)), new Vector3())
    .multiplyScalar(1 / (triangles.length * 3));
  const ends = curves.flatMap((c) => [
    { p: at(c.a), tangent: c.tangent },
    { p: at(c.b), tangent: c.tangent + c.turn },
  ]);
  const start = ends.toSorted(
    (m, n) => m.p.distanceTo(middle) - n.p.distanceTo(middle),
  )[0];
  if (!start) return [];
  const normal = new Vector3(...frame.xAxis)
    .cross(new Vector3(...frame.yAxis))
    .normalize();
  return curves.flatMap((c) =>
    [0, Math.PI].flatMap((flip) => {
      const posed = triangles.map((tri) =>
        tri.map((p) =>
          new Vector3(...p)
            .sub(start.p)
            .applyAxisAngle(normal, c.tangent - start.tangent + flip)
            .add(at(c.a))
            .toArray(),
        ),
      );
      return c.center
        ? turnedCells(posed, at(c.center).toArray(), normal.toArray(), c.turn)
        : movedCells(posed, at(c.b).sub(at(c.a)).toArray());
    }),
  );
}

export const sweep: FeatureUI<SweepFeature, SweepParams> = {
  type: "sweep",
  initialParams: {},
  icon: "〰",
  title: "Sweep",
  group: "create",
  picks: [profiles, path, targets],
  Form: SweepForm,
  build: (params, selection) => {
    const refs = profileRefs(selection);
    if (refs.length === 0) return { error: "Select a profile" };
    const pathSketchId = params.pathSketchId ?? "";
    if (!pathSketchId) return { error: "Choose a path sketch" };
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("sweep"),
      type: "sweep",
      name: params.name ?? "",
      suppressed: false,
      profiles: refs,
      pathSketchId,
      operation,
      ...bodyTargets(operation, params),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      targets: f.targets,
      pathSketchId: f.pathSketchId,
      operation: f.operation,
    },
    selection: profilePicks(f.profiles),
  }),
  onParamsChange: (params) =>
    autoOperation(params, () => toolOperation(sweepCells(params.pathSketchId))),
};

registerFeatureUI(sweep);
