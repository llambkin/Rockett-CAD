import { LINEAR_TOL, type EdgeRef, type Vec3 } from "@rockett/shared";
import { chamferSection } from "./blendModule.js";
import { chamferSides } from "./blendSides.js";
import { NoCorner, vertexPoint, type ToolResult } from "./featureState.js";
import { V } from "./frames.js";
import {
  dir,
  getKernel,
  kernelCall,
  pnt,
  vertices,
  type Own,
  type Shape,
} from "./kernel.js";
import type { NamedBody } from "./naming.js";
import { planarInteriorPoints } from "./planeBoundary.js";
import { planarBlend, type BlendStrip } from "./planarFillet.js";
import { boundsReach } from "./planarFilletSurface.js";

function consumed(
  face: Shape,
  bands: { at: Vec3; into: Vec3 }[],
  distance: number,
  own: Own,
) {
  return [
    ...vertices(face).map(own).map(vertexPoint),
    ...planarInteriorPoints(face, own).map((p): Vec3 => [p.X(), p.Y(), p.Z()]),
  ].every((point) =>
    bands.some(({ at, into }) => {
      const depth = V.dot(V.sub(point, at), into);
      return depth >= -LINEAR_TOL && depth <= distance + LINEAR_TOL;
    }),
  );
}

function chamferStrip(distance: number): BlendStrip {
  return {
    kind: "chamfer",
    size: distance,
    sides: chamferSides,
    accepts(chain, sides, own) {
      const ends = chain.flatMap(({ edge }) => vertices(edge).map(own));
      return (
        ends.every(
          (vertex) => ends.filter((end) => end.IsSame(vertex)).length <= 2,
        ) &&
        sides.flat().every(
          ({ face }) =>
            !consumed(
              face,
              chain.flatMap(({ edge }, i) =>
                sides[i]!.filter((side) => side.face.IsSame(face)).map(
                  (side) => ({
                    at: vertexPoint(vertices(edge).map(own)[0]!),
                    into: side.into,
                  }),
                ),
              ),
              distance,
              own,
            ),
        )
      );
    },
    face(points, sides, axis, own, bounds) {
      const k = getKernel();
      const section = chamferSection(points, sides, distance);
      if (!section)
        throw new NoCorner(
          "no sharp corner to chamfer: the faces meet smoothly there",
        );
      const [origin, across] = section[0];
      const width = V.norm(V.sub(across, origin));
      const x = V.scale(V.sub(across, origin), 1 / width);
      const span = boundsReach(bounds, origin, axis);
      const plane = own(
        new k.gp_Pln_2(
          own(
            new k.gp_Ax3_3(
              own(pnt(...origin)),
              own(dir(...V.cross(x, axis))),
              own(dir(...x)),
            ),
          ),
        ),
      );
      const make = own(
        new k.BRepBuilderAPI_MakeFace_9(
          plane,
          0,
          width,
          Math.min(...span),
          Math.max(...span),
        ),
      );
      if (!make.IsDone())
        throw new Error("the planar chamfer surface could not be built");
      return own(make.Face());
    },
  };
}

export function planarChamfer(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  distance: number,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult | null {
  try {
    return kernelCall("chamfer", () =>
      planarBlend(
        body,
        selected,
        chamferStrip(distance),
        featureId,
        byName,
        refs,
      ),
    );
  } catch {
    return null;
  }
}
