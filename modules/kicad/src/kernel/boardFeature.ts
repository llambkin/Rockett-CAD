import {
  defineTimelineFeature,
  Placement,
  placementSchema,
  StoreError,
  type KernelJobScope,
  type TimelineFeatureScope,
} from "@rockett/plugin-api";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { circle, TAU } from "../boardGeometry.js";
import {
  dataSchema,
  drillSchema,
  hashSchema,
  loop,
  NAMESPACE,
  point,
  READ_VERSIONS,
  snapshotSchema,
  type Snapshot,
} from "../shared/data.js";
import { modelPlacement, resolveModel } from "../shared/models.js";

type Shape = { delete(): void };
type Claim = [face: Shape, label: string];

const envelopeSchema = Type.Object({
  version: Type.Union(READ_VERSIONS.map((version) => Type.Literal(version))),
  data: dataSchema,
});
const identitySchema = Type.Object({
  snapshot: hashSchema,
  models: Type.Record(Type.String(), hashSchema),
});

const paramsSchema = Type.Object({
  linkId: Type.String({ minLength: 1, maxLength: 128 }),
  placement: placementSchema,
  options: Type.Object({}, { additionalProperties: false }),
});

type Loop = Static<typeof loop>;
type Segment = Loop[number];
type Point = Static<typeof point>;
type Drill = Static<typeof drillSchema>;
type Placed = { rotation: readonly number[]; translation: readonly number[] };

const UUID = /^[0-9a-z-]{1,40}$/;
const PLACEHOLDER_HEIGHT = 1;

function edge({ oc, own }: KernelJobScope, s: Segment, z: number) {
  const at = ([x, y]: Point) => own(new oc.gp_Pnt_3(x, y, z));
  if (s.kind === "line")
    return own(new oc.BRepBuilderAPI_MakeEdge_3(at(s.from), at(s.to)));
  const axis = own(
    new oc.gp_Ax2_4(
      at(s.centre),
      own(new oc.gp_Dir_5(0, 0, s.sweep > 0 ? 1 : -1)),
    ),
  );
  const radius = Math.hypot(s.from[0] - s.centre[0], s.from[1] - s.centre[1]);
  const round = own(new oc.gp_Circ_2(axis, radius));
  return own(
    Math.abs(s.sweep) === TAU
      ? new oc.BRepBuilderAPI_MakeEdge_8(round)
      : new oc.BRepBuilderAPI_MakeEdge_10(round, at(s.from), at(s.to)),
  );
}

function joined(segments: Loop): Loop {
  return segments.map((s, i) => {
    if (s.kind !== "line") return s;
    const before = segments.at(i - 1)!;
    const after = segments[(i + 1) % segments.length]!;
    return {
      ...s,
      from: before.kind === "arc" ? before.to : s.from,
      to: after.from,
    };
  });
}

function prism(scope: KernelJobScope, segments: Loop, z: number, h: number) {
  const { oc, own } = scope;
  const wire = own(new oc.BRepBuilderAPI_MakeWire_1());
  const edges = joined(segments).map((s) => {
    const made = edge(scope, s, z);
    if (!made.IsDone())
      throw new Error("KiCad board has an edge it cannot build");
    wire.Add_1(own(made.Edge()));
    if (!wire.IsDone())
      throw new Error("KiCad board loop is not a connected wire");
    return own(wire.Edge());
  });
  const face = own(new oc.BRepBuilderAPI_MakeFace_15(own(wire.Wire()), true));
  if (!face.IsDone())
    throw new Error("KiCad board loop is not a closed planar loop");
  const made = own(
    new oc.BRepPrimAPI_MakePrism_1(
      own(face.Face()),
      own(new oc.gp_Vec_4(0, 0, h)),
      false,
      true,
    ),
  );
  return {
    shape: own(made.Shape()),
    bottom: own(made.FirstShape()),
    top: own(made.LastShape()),
    walls: edges.map((built) => own(own(made.Generated(built)).First_1())),
  };
}

function slot([x, y]: Point, degrees: number, { width, height }: Drill): Loop {
  const theta = (degrees * Math.PI) / 180;
  const long = width >= height;
  const r = (long ? height : width) / 2;
  const a = Math.abs(width - height) / 2;
  const u: Point = long
    ? [Math.cos(theta), Math.sin(theta)]
    : [-Math.sin(theta), Math.cos(theta)];
  const v: Point = [-u[1], u[0]];
  const p = (s: number, t: number): Point => [
    x + s * u[0] + t * v[0],
    y + s * u[1] + t * v[1],
  ];
  if (a === 0) return [circle([x, y], p(r, 0))];
  return [
    { kind: "line", from: p(-a, -r), to: p(a, -r) },
    {
      kind: "arc",
      from: p(a, -r),
      to: p(a, r),
      centre: p(a, 0),
      sweep: Math.PI,
    },
    { kind: "line", from: p(a, r), to: p(-a, r) },
    {
      kind: "arc",
      from: p(-a, r),
      to: p(-a, -r),
      centre: p(-a, 0),
      sweep: Math.PI,
    },
  ];
}

function tools(data: Snapshot) {
  const cutouts = data.cutouts.map((segments, c) => ({
    segments,
    prefix: `cutout:${c}`,
  }));
  const drills = data.footprints.flatMap(({ uuid, pads }) =>
    pads.flatMap(({ x, y, angle, drill }, p) =>
      drill
        ? [
            {
              segments: slot([x, y], angle, drill),
              prefix:
                uuid !== undefined && UUID.test(uuid)
                  ? `drill:${uuid}:${p}`
                  : undefined,
            },
          ]
        : [],
    ),
  );
  return [...cutouts, ...drills];
}

function cut(scope: KernelJobScope, body: Shape, cutters: Shape[]) {
  const { oc, own } = scope;
  if (!cutters.length) return { shape: body, after: (face: Shape) => face };
  const list = (shapes: Shape[]) => {
    const made = own(new oc.TopTools_ListOfShape_1());
    for (const shape of shapes) made.Append_1(shape);
    return made;
  };
  const op = own(new oc.BRepAlgoAPI_Cut_1());
  op.SetArguments(list([body]));
  op.SetTools(list(cutters));
  op.Build(own(new oc.Message_ProgressRange_1()));
  if (!op.IsDone()) throw new Error("KiCad board cut failed");
  return {
    shape: own(op.Shape()),
    after(face: Shape): Shape | undefined {
      if (op.IsDeleted(face)) return undefined;
      const made = own(op.Modified(face));
      return made.Size() === 0
        ? face
        : made.Size() === 1
          ? own(made.First_1())
          : undefined;
    },
  };
}

function placed(
  scope: KernelJobScope,
  shape: Shape,
  claims: Claim[],
  { rotation, translation }: Placed,
  scale = 1,
) {
  const { oc, own } = scope;
  const trsf = own(new oc.gp_Trsf_1());
  trsf.SetRotation_2(own(new oc.gp_Quaternion_2(...rotation)));
  trsf.SetTranslationPart(own(new oc.gp_Vec_4(...translation)));
  if (scale !== 1) trsf.SetScaleFactor(scale);
  const moved = own(
    new oc.BRepBuilderAPI_Transform_2(shape, trsf, false, false),
  );
  return {
    shape: own(moved.Shape()),
    faces: claims.map(([face, label]): Claim => [
      own(moved.ModifiedShape(face)),
      label,
    ]),
  };
}

function components(
  scope: TimelineFeatureScope<typeof paramsSchema>,
  { thickness, footprints }: Snapshot,
  models: Readonly<Record<string, string>>,
  bytesOf: (hash: string) => Uint8Array,
) {
  const { oc, own, params } = scope;
  const { rotation, translation } = params.placement;
  const board: Placement = {
    rotation: [...rotation],
    translation: [...translation],
  };
  const read = new Map<string, Shape[]>();
  const parts = (hash: string) => {
    const known = read.get(hash);
    if (known) return known;
    const shapes: Shape[] = scope.readStep(bytesOf(hash));
    read.set(hash, shapes);
    return shapes;
  };
  return footprints.flatMap((footprint) => {
    const { uuid, reference, side, courtyard } = footprint;
    if (uuid === undefined || !UUID.test(uuid) || !side) return [];
    const body = (shape: Shape, approximate: boolean) => [
      {
        key: `${params.linkId}:${uuid}`,
        name: reference?.trim() ? reference : uuid,
        shape,
        reference: true,
        approximate,
      },
    ];
    const uploaded = footprint.models.flatMap((model) => {
      const use = resolveModel(model, models);
      return use.status === "uploaded" ? [{ model, sha256: use.sha256 }] : [];
    });
    if (uploaded.length && uploaded.length === footprint.models.length) {
      const builder = own(new oc.BRep_Builder());
      const compound = own(new oc.TopoDS_Compound());
      builder.MakeCompound(compound);
      for (const { model, sha256 } of uploaded) {
        const { placement, scale } = modelPlacement(
          footprint,
          model,
          thickness,
        );
        const at = Placement.compose(board, placement);
        for (const part of parts(sha256))
          builder.Add(compound, placed(scope, part, [], at, scale).shape);
      }
      return body(compound, false);
    }
    if (!courtyard) return [];
    const { min, max } = courtyard;
    if (max[0] <= min[0] || max[1] <= min[1]) return [];
    const z = side === "front" ? thickness : -PLACEHOLDER_HEIGHT;
    const box = own(
      new oc.BRepPrimAPI_MakeBox_4(
        own(new oc.gp_Pnt_3(min[0], min[1], z)),
        own(new oc.gp_Pnt_3(max[0], max[1], z + PLACEHOLDER_HEIGHT)),
      ),
    );
    return body(
      placed(scope, own(box.Shape()), [], params.placement).shape,
      true,
    );
  });
}

function unique(scope: KernelJobScope, shape: Shape, claims: Claim[]) {
  const { oc, own } = scope;
  const map = own(new oc.TopTools_IndexedMapOfShape_1());
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  const counts = new Map<number, number>();
  const indexed = claims.map((claim) => {
    const index: number = map.FindIndex(claim[0]);
    counts.set(index, (counts.get(index) ?? 0) + 1);
    return { claim, index };
  });
  return indexed
    .filter(({ index }) => index > 0 && counts.get(index) === 1)
    .map(({ claim }) => claim);
}

export const board = defineTimelineFeature({
  spec: {
    type: "rockett.kicad.board",
    label: "KiCad board",
    version: 1,
    params: paramsSchema,
    resolveInputs({ params: { linkId }, extensions }) {
      const stored = extensions[NAMESPACE];
      if (!Value.Check(envelopeSchema, stored))
        throw new StoreError(
          "KiCad data is missing or not supported",
          "unprocessable",
        );
      const link = Object.hasOwn(stored.data.links, linkId)
        ? stored.data.links[linkId]
        : undefined;
      if (!link)
        throw new StoreError(
          `KiCad board link ${linkId} is not in this project`,
          "unprocessable",
        );
      const models = link.models ?? {};
      return {
        identity: { snapshot: link.snapshotAsset, models },
        assets: [link.snapshotAsset, ...Object.values(models)],
      };
    },
  },
  evaluate(scope) {
    const identity = scope.inputs?.identity;
    if (!Value.Check(identitySchema, identity))
      throw new Error("KiCad board inputs are missing");
    const hashes = [
      ...new Set([identity.snapshot, ...Object.values(identity.models)]),
    ].toSorted();
    const bytesOf = (hash: string) => {
      const bytes = scope.inputs?.assets[hashes.indexOf(hash)];
      if (!bytes) throw new Error(`KiCad board asset ${hash} is missing`);
      return bytes;
    };
    const snapshot: unknown = JSON.parse(
      new TextDecoder().decode(bytesOf(identity.snapshot)),
    );
    if (!Value.Check(snapshotSchema, snapshot))
      throw new Error("KiCad board snapshot is not supported or valid");
    const { thickness, outline } = snapshot.data;
    const body = prism(scope, outline, 0, thickness);
    const listed = tools(snapshot.data);
    const cutters = listed.map(({ segments, prefix }, i) => {
      scope.progress(i, listed.length, "KiCad board");
      return { made: prism(scope, segments, -1, thickness + 2), prefix };
    });
    const result = cut(
      scope,
      body.shape,
      cutters.map(({ made }) => made.shape),
    );
    const claims = [
      [body.top, "top"] as Claim,
      [body.bottom, "bottom"] as Claim,
      ...body.walls.map((face, i): Claim => [face, `edge:${i}`]),
      ...cutters.flatMap(({ made, prefix }) =>
        prefix === undefined
          ? []
          : made.walls.map((face, s): Claim => [face, `${prefix}:${s}`]),
      ),
    ].flatMap(([face, label]) => {
      const kept = result.after(face);
      return kept ? [[kept, label] as Claim] : [];
    });
    const { shape, faces } = placed(
      scope,
      result.shape,
      unique(scope, result.shape, claims),
      scope.params.placement,
    );
    return {
      shape,
      faces,
      bodies: components(scope, snapshot.data, identity.models, bytesOf),
    };
  },
});
