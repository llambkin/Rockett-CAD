import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import { V } from "./frames.js";
import type { StateBody, ToolResult } from "./features.js";
import {
  bboxOf,
  edgeCentroid,
  getKernel,
  lengthOf,
  progress,
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

export function bboxOverlap(a: Shape, b: Shape): boolean {
  const ba = bboxOf(a);
  const bb = bboxOf(b);
  const margin = LINEAR_TOL;
  for (let i = 0; i < 3; i++) {
    if (ba.max[i]! < bb.min[i]! - margin || bb.max[i]! < ba.min[i]! + -margin) {
      return false;
    }
  }
  return true;
}

function contactFuse(a: Shape, b: Shape): any {
  if (!bboxOverlap(a, b)) return null;
  const k = getKernel();
  const dist = new k.BRepExtrema_DistShapeShape_2(
    a,
    b,
    k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
    k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
    progress(),
  );
  const done = dist.IsDone();
  const value = done ? dist.Value() : 0;
  dist.delete();
  if (!done) throw new Error("join contact check failed");
  if (value > LINEAR_TOL) return null;
  const op = new k.BRepAlgoAPI_Fuse_3(a, b, progress());
  op.Build(progress());
  const failed = !op.IsDone();
  if (!failed && scoped((own) => solids(own(op.Shape())).map(own).length === 1))
    return op;
  op.delete();
  if (failed) throw new Error("join contact check failed");
  return null;
}

type JoinGroup = { bodies: StateBody[]; pieces: ToolResult[]; fuse: any };

export function contactGroups(
  bodies: StateBody[],
  tool: ToolResult,
  held: Set<any>,
) {
  let groups: JoinGroup[] = [];
  const loose: Shape[] = [];
  for (const shape of solids(tool.shape)) {
    const hits = bodies.flatMap((body) => {
      const fuse = contactFuse(body.shape, shape);
      if (!fuse) return [];
      held.add(fuse);
      return [{ body, fuse }];
    });
    if (hits.length === 0) {
      loose.push(shape);
      continue;
    }
    const hit = (b: StateBody) => hits.some((h) => h.body === b);
    const bridged = groups.filter((g) => g.bodies.some(hit));
    const joined = bodies.filter(
      (b) => hit(b) || bridged.some((g) => g.bodies.includes(b)),
    );
    const fuse = joined.length === 1 ? (bridged[0] ?? hits[0]!).fuse : null;
    for (const { fuse: op } of [...hits, ...bridged]) {
      if (!op || op === fuse) continue;
      held.delete(op);
      op.delete();
    }
    groups = [
      ...groups.filter((g) => !bridged.includes(g)),
      {
        bodies: joined,
        pieces: [...bridged.flatMap((g) => g.pieces), { ...tool, shape }],
        fuse,
      },
    ];
  }
  return { groups, loose };
}
