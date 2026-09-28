import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import { V } from "./frames.js";
import {
  edgeCentroid,
  getKernel,
  lengthOf,
  scoped,
  solids,
  type Shape,
} from "./kernel.js";

interface ThinEdge {
  length: number;
  at: Vec3;
}

function zeroThicknessEdges(shape: Shape): ThinEdge[] {
  const k = getKernel();
  return scoped((own) =>
    solids(shape).flatMap((solid) => {
      own(solid);
      const map = own(new k.TopTools_IndexedDataMapOfShapeListOfShape_1());
      k.TopExp.MapShapesAndUniqueAncestors(
        solid,
        k.TopAbs_ShapeEnum.TopAbs_EDGE,
        k.TopAbs_ShapeEnum.TopAbs_FACE,
        map,
        false,
      );
      const found: ThinEdge[] = [];
      for (let i = 1; i <= map.Extent(); i++) {
        if (map.FindFromIndex_2(i).Size() <= 2) continue;
        const edge = own(map.FindKey_2(i));
        found.push({ length: lengthOf(edge), at: edgeCentroid(edge) });
      }
      return found;
    }),
  );
}

export function zeroThicknessWarning(
  joined: Shape,
  inputs: Shape[],
): string | undefined {
  const made = zeroThicknessEdges(joined);
  if (made.length === 0) return undefined;
  const had = inputs.flatMap(zeroThicknessEdges);
  const fresh = made.filter(
    (edge) =>
      !had.some(
        (old) =>
          Math.abs(old.length - edge.length) < LINEAR_TOL &&
          V.norm(V.sub(old.at, edge.at)) < LINEAR_TOL,
      ),
  );
  if (fresh.length === 0) return undefined;
  const lengths = fresh.map((e) => `${Number(e.length.toFixed(3))} mm`);
  const what =
    fresh.length === 1 ? "a zero-thickness edge" : "zero-thickness edges";
  return `join left ${what} (${lengths.join(", ")})`;
}
