import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Xy } from "../shared/ir.js";
import {
  chain,
  edge,
  shapes,
  type RegionLoop,
  type Segment,
} from "./regions.js";

export type OffsetInput = { loop: RegionLoop; distance: number };

function segmentEdge(
  { oc, own }: KernelJobScope,
  from: Xy,
  segment: Segment,
  closed: boolean,
) {
  const point = ([x, y]: Xy) => own(new oc.gp_Pnt_3(x, y, 0));
  if (segment.kind === "line")
    return new oc.BRepBuilderAPI_MakeEdge_3(point(from), point(segment.to));
  const [cx, cy] = segment.centre;
  const axis = own(
    new oc.gp_Ax2_4(
      point(segment.centre),
      own(new oc.gp_Dir_5(0, 0, segment.dir === "ccw" ? 1 : -1)),
    ),
  );
  const circle = own(
    new oc.gp_Circ_2(axis, Math.hypot(from[0] - cx, from[1] - cy)),
  );
  return closed
    ? new oc.BRepBuilderAPI_MakeEdge_8(circle)
    : new oc.BRepBuilderAPI_MakeEdge_10(circle, point(from), point(segment.to));
}

function face(scope: KernelJobScope, loop: RegionLoop) {
  const { oc, own } = scope;
  const wire = own(new oc.BRepBuilderAPI_MakeWire_1());
  let from = loop.start;
  for (const segment of loop.segments) {
    const made = own(
      segmentEdge(scope, from, segment, loop.segments.length === 1),
    );
    if (!made.IsDone())
      throw new Error("offset loop has an edge it cannot build");
    wire.Add_1(own(made.Edge()));
    from = segment.to;
  }
  if (!wire.IsDone()) throw new Error("offset loop is not a connected wire");
  const made = own(new oc.BRepBuilderAPI_MakeFace_15(own(wire.Wire()), true));
  if (!made.IsDone())
    throw new Error("offset loop is not a closed planar loop");
  return own(made.Face());
}

function collapses({ loop, distance }: OffsetInput) {
  const [first] = loop.segments;
  if (first?.kind !== "arc") return false;
  const [cx, cy] = first.centre;
  const radius = Math.hypot(loop.start[0] - cx, loop.start[1] - cy);
  return (
    radius + distance <= 0 &&
    loop.segments.every(
      (segment) =>
        segment.kind === "arc" &&
        segment.centre[0] === cx &&
        segment.centre[1] === cy,
    )
  );
}

export default defineKernelJobs({
  "rockett.cam.offset": (input: OffsetInput, scope): RegionLoop[] => {
    const { oc, own } = scope;
    if (!(Number.isFinite(input.distance) && input.distance !== 0))
      throw new RangeError("offset distance must be a finite number, not 0");
    const offset = own(
      new oc.BRepOffsetAPI_MakeOffset_2(
        face(scope, input.loop),
        oc.GeomAbs_JoinType.GeomAbs_Arc,
        false,
      ),
    );
    offset.Perform(input.distance, 0);
    if (!offset.IsDone()) {
      if (collapses(input)) return [];
      throw new Error(`offset of the loop by ${input.distance} mm failed`);
    }
    const result = own(offset.Shape());
    if (result.IsNull()) return [];
    const edges = [...shapes(scope, result, "TopAbs_EDGE")];
    return chain(
      edges.map((shape) => edge(scope, shape, 0)),
      0,
    );
  },
});
