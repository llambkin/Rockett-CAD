import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type {
  Footprint,
  PlanFeatures,
  PocketFeature,
  ProfileFeature,
} from "../plan/plan.js";
import type { Xy } from "../shared/ir.js";
import type { FaceRef } from "../shared/params.js";
import {
  stockBox,
  type Box,
  type Placement,
  type StockSetup,
} from "../shared/setup.js";
import {
  area,
  chorded,
  gap,
  offsetLoops,
  pieces,
} from "../toolpath/geometry.js";
import { boundsOf, holesOf, solidLeft, zRange, type Hole } from "./holes.js";
import {
  planeOf,
  read,
  shapes,
  toSetup,
  unstable,
  wireLoop,
  type FaceBody,
  type RegionLoop,
  type Segment,
} from "./regions.js";

export type FeaturesInput = {
  setup: StockSetup;
  bodies: (FaceBody & { bbox: Box })[];
};

type Flat = { index: number; face: any; z: number; up: boolean };

type Part = {
  body: FaceBody;
  model: any[];
  shape: any;
  walls: any;
  flats: Flat[];
  bottom: number;
  top: number;
  holes: Hole[];
};

const LENGTH = 1e-6;
const RISE = 1e-4;
const FACING = 1 - 1e-9;
const TURN = 1e-6;
const WIDTH = 0.0025;

function partOf(scope: KernelJobScope, body: FaceBody, at: Placement): Part {
  const { oc, own } = scope;
  const model = read(scope, body.brep, "features");
  const shape = toSetup(scope, model, at);
  const walls = own(new oc.TopTools_IndexedDataMapOfShapeListOfShape_1());
  oc.TopExp.MapShapesAndAncestors(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    walls,
  );
  const flats = [...shapes(scope, shape, "TopAbs_FACE")].flatMap(
    (each, index): Flat[] => {
      const face = own(oc.TopoDS.Face_1(each));
      const plane = planeOf(scope, face);
      if (!plane || Math.abs(plane.direction[2]) < FACING) return [];
      return [{ index, face, z: plane.point[2], up: plane.direction[2] > 0 }];
    },
  );
  const [bottom, top] = zRange(scope, shape);
  return {
    body,
    model: [...shapes(scope, model, "TopAbs_FACE")],
    shape,
    walls,
    flats,
    bottom,
    top,
    holes: holesOf(scope, shape),
  };
}

function footprintOf(scope: KernelJobScope, shape: any): Footprint {
  const [min, max] = boundsOf(scope, shape);
  return { min: [min.X(), min.Y()], max: [max.X(), max.Y()] };
}

function refOf(scope: KernelJobScope, { body, model }: Part, index: number) {
  const faceName = body.faceNames[index];
  const face = model[index];
  if (!faceName || unstable(faceName) || !face) return undefined;
  const { point, direction } = planeOf(
    scope,
    scope.own(scope.oc.TopoDS.Face_1(face)),
  )!;
  const ref: FaceRef = {
    kind: "face",
    bodyId: body.id,
    faceName,
    sig: { type: "plane", point, direction },
  };
  return ref;
}

function loopOf(scope: KernelJobScope, wire: any, z: number) {
  const { oc, own } = scope;
  const plain = new Set([
    oc.GeomAbs_CurveType.GeomAbs_Line,
    oc.GeomAbs_CurveType.GeomAbs_Circle,
  ]);
  for (const edge of shapes(scope, wire, "TopAbs_EDGE"))
    if (
      !plain.has(
        own(new oc.BRepAdaptor_Curve_2(own(oc.TopoDS.Edge_1(edge)))).GetType(),
      )
    )
      return undefined;
  return wireLoop(scope, wire, z);
}

function wiresOf(scope: KernelJobScope, face: any, z: number) {
  const outer = scope.own(scope.oc.BRepTools.OuterWire(face));
  const inner = [...shapes(scope, face, "TopAbs_WIRE")].filter(
    (wire) => !wire.IsSame(outer),
  );
  return {
    outer,
    inner,
    outerLoop: loopOf(scope, outer, z),
    innerLoops: inner.map((wire) => loopOf(scope, wire, z)),
  };
}

function prism(scope: KernelJobScope, face: any, from: number, to: number) {
  const { oc, own } = scope;
  return own(
    own(
      new oc.BRepPrimAPI_MakePrism_1(
        face,
        own(new oc.gp_Vec_4(0, 0, to - from + 1)),
        false,
        true,
      ),
    ).Shape(),
  );
}

function wireFace({ oc, own }: KernelJobScope, wire: any) {
  return own(
    own(
      new oc.BRepBuilderAPI_MakeFace_15(own(oc.TopoDS.Wire_1(wire)), true),
    ).Face(),
  );
}

function emptyIn(scope: KernelJobScope, body: any, tool: any) {
  const { oc, own } = scope;
  return !solidLeft(
    scope,
    own(
      new oc.BRepAlgoAPI_Common_3(
        body,
        tool,
        own(new oc.Message_ProgressRange_1()),
      ),
    ),
  );
}

function within(scope: KernelJobScope, body: any, tool: any) {
  const { oc, own } = scope;
  return !solidLeft(
    scope,
    own(
      new oc.BRepAlgoAPI_Cut_3(
        body,
        tool,
        own(new oc.Message_ProgressRange_1()),
      ),
    ),
  );
}

function walled(scope: KernelJobScope, { walls }: Part, flat: Flat, wire: any) {
  const { own } = scope;
  for (const edge of shapes(scope, wire, "TopAbs_EDGE")) {
    const faces = own(walls.FindFromIndex_2(walls.FindIndex(edge)));
    let rising = 0;
    for (; faces.Size() > 0; faces.RemoveFirst()) {
      const face = own(faces.First_1());
      if (face.IsSame(flat.face)) continue;
      const [low, high] = zRange(scope, face);
      if (low < flat.z - RISE || high <= flat.z + RISE) return false;
      rising++;
    }
    if (!rising) return false;
  }
  return true;
}

const isHole = (loop: RegionLoop, holes: Hole[]) =>
  holes.some(({ centre, diameter }) =>
    [...pieces(loop)].every(
      ({ from, segment }) =>
        segment.kind === "arc" &&
        gap(segment.centre, centre) <= LENGTH &&
        Math.abs(gap(from, segment.centre) - diameter / 2) <= LENGTH,
    ),
  );

function oriented(loop: RegionLoop, sign: number) {
  const points = chorded(loop);
  return Math.sign(area(loop)) === sign ? points : points.toReversed();
}

function inscribedWidth(outer: RegionLoop, inner: RegionLoop[]) {
  const loops = [
    oriented(outer, 1),
    ...inner.map((loop) => oriented(loop, -1)),
  ];
  const xs = loops[0]!.map(({ x }) => x);
  const ys = loops[0]!.map(({ y }) => y);
  let low = 0;
  let high =
    Math.min(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ) / 2;
  while (high - low > WIDTH) {
    const mid = (low + high) / 2;
    if (offsetLoops(loops, -mid).length) low = mid;
    else high = mid;
  }
  return low + high;
}

function tangent(from: Xy, segment: Segment, at: Xy): Xy {
  const [x, y] =
    segment.kind === "line"
      ? [segment.to[0] - from[0], segment.to[1] - from[1]]
      : segment.dir === "ccw"
        ? [segment.centre[1] - at[1], at[0] - segment.centre[0]]
        : [at[1] - segment.centre[1], segment.centre[0] - at[0]];
  const length = Math.hypot(x, y);
  return [x / length, y / length];
}

function smallestCorner(loop: RegionLoop, side: number) {
  const turn = Math.sign(area(loop)) * side;
  const parts = [...pieces(loop)];
  return Math.min(
    ...parts.map(({ from, segment }, i) => {
      const next = parts[(i + 1) % parts.length]!;
      const [ax, ay] = tangent(from, segment, segment.to);
      const [bx, by] = tangent(next.from, next.segment, next.from);
      if ((ax * by - ay * bx) * turn > TURN) return 0;
      return segment.kind === "arc" && (segment.dir === "ccw" ? 1 : -1) === turn
        ? gap(from, segment.centre)
        : Infinity;
    }),
  );
}

function pocketsOf(
  scope: KernelJobScope,
  part: Part,
  modelTop: number,
  count: () => number,
): PocketFeature[] {
  return part.flats.flatMap((flat): PocketFeature[] => {
    if (!flat.up || flat.z >= modelTop - LENGTH) return [];
    const floor = refOf(scope, part, flat.index);
    const { outer, outerLoop, innerLoops } = wiresOf(scope, flat.face, flat.z);
    const inner = innerLoops.filter((loop) => loop !== undefined);
    if (
      !floor ||
      !outerLoop ||
      inner.length !== innerLoops.length ||
      isHole(outerLoop, part.holes) ||
      !walled(scope, part, flat, outer) ||
      !emptyIn(scope, part.shape, prism(scope, flat.face, flat.z, part.top))
    )
      return [];
    return [
      {
        id: `pocket:${part.body.id}:${floor.faceName}`,
        name: `Pocket ${count()}`,
        floor,
        z: flat.z,
        footprint: footprintOf(scope, outer),
        width: inscribedWidth(outerLoop, inner),
        cornerRadius: Math.min(
          smallestCorner(outerLoop, 1),
          ...inner.map((loop) => smallestCorner(loop, -1)),
        ),
      },
    ];
  });
}

function profilesOf(
  scope: KernelJobScope,
  part: Part,
  count: { outline: () => number; opening: () => number },
): ProfileFeature[] {
  const bottoms = part.flats.filter(
    ({ up, z }) => !up && z <= part.bottom + LENGTH,
  );
  const [flat] = bottoms;
  if (bottoms.length !== 1 || !flat) return [];
  const face = refOf(scope, part, flat.index);
  if (!face) return [];
  const { z } = flat;
  const { outer, inner, outerLoop, innerLoops } = wiresOf(scope, flat.face, z);
  const column = (wire: any) =>
    prism(scope, wireFace(scope, wire), z, part.top);
  const outside: ProfileFeature[] =
    outerLoop && within(scope, part.shape, column(outer))
      ? [
          {
            id: `outline:${part.body.id}`,
            name: `Outline ${count.outline()}`,
            face,
            z,
            footprint: footprintOf(scope, outer),
            side: "outside",
          },
        ]
      : [];
  const insides = inner.flatMap((wire, index): ProfileFeature[] => {
    const loop = innerLoops[index];
    if (
      !loop ||
      isHole(loop, part.holes) ||
      !emptyIn(scope, part.shape, column(wire))
    )
      return [];
    return [
      {
        id: `opening:${part.body.id}:${face.faceName}:${index}`,
        name: `Opening ${count.opening()}`,
        face,
        z,
        footprint: footprintOf(scope, wire),
        side: "inside",
        opening: index,
        width: inscribedWidth(loop, []),
        cornerRadius: smallestCorner(loop, 1),
      },
    ];
  });
  return [...insides, ...outside];
}

const counter = () => {
  let n = 0;
  return () => ++n;
};

export default defineKernelJobs({
  "rockett.cam.features": (input: FeaturesInput, scope): PlanFeatures => {
    const stock = stockBox(
      input.setup,
      Object.fromEntries(input.bodies.map(({ id, bbox }) => [id, bbox])),
    );
    const parts = input.bodies.map((body) =>
      partOf(scope, body, stock.modelToSetup),
    );
    const modelTop = Math.max(...parts.map(({ top }) => top));
    const pocket = counter();
    const count = { outline: counter(), opening: counter() };
    return {
      stockTop: stock.max[2],
      stockOutline: {
        min: [stock.min[0], stock.min[1]],
        max: [stock.max[0], stock.max[1]],
      },
      modelTop,
      holes: parts.flatMap(({ holes }) => holes),
      pockets: parts.flatMap((each) =>
        pocketsOf(scope, each, modelTop, pocket),
      ),
      profiles: parts.flatMap((each) => profilesOf(scope, each, count)),
    };
  },
});
