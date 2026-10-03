import { type EdgeRef, type FilletFeature } from "@rockett/shared";
import { fuseNamed, unifyTool, splitAtEnds } from "./boolean.js";
import {
  acquire,
  getKernel,
  progress,
  scoped,
  shapeHash,
  type Shape,
} from "./kernel.js";
import { NoCorner, type ToolResult } from "./featureState.js";
import { type NamedBody } from "./naming.js";
import { openEnds, spilledEnds, type OpenEnd } from "./blendEnds.js";
import { blendNames } from "./blendNaming.js";
import { rejectBadBlend } from "./blendValidity.js";

export function rejectEmptyFilletContours(
  op: any,
  sourceEdges: { name: string }[],
): void {
  if (op.NbContours() === 0) {
    throw new NoCorner(
      `no sharp corner to fillet on ${sourceEdges.map((s) => s.name).join(", ")}: the faces meet smoothly there`,
    );
  }
}

export function nativeFillet(
  body: NamedBody,
  sourceEdges: { edge: Shape; name: string }[],
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  f: FilletFeature,
): ToolResult {
  const k = getKernel();
  const op = acquire(
    new k.BRepFilletAPI_MakeFillet(
      body.shape,
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    ),
  );
  let result: Shape | undefined;
  {
    for (const { edge } of sourceEdges) {
      if (!op.Contour(edge)) op.Add_2(f.radius, edge);
    }
    rejectEmptyFilletContours(op, sourceEdges);
    op.Build(progress());
    const spilled = op.IsDone() ? spilledEnds(op) : new Set<number>();
    const ends =
      !op.IsDone() || spilled.size > 0
        ? openEnds(op, sourceEdges, spilled)
        : [];
    const clipped =
      ends.length > 0 && filletClipped(body, sourceEdges, ends, f);
    if (clipped) {
      result = clipped.shape;
      return clipped;
    }
    if (!op.IsDone()) {
      throw new Error(filletFailure(op, byName, refs, f.radius));
    }
    result = acquire(op.Shape());
    rejectBadBlend(
      op,
      sourceEdges,
      result,
      body.shape,
      "fillet",
      `radius ${f.radius}`,
      "try fewer edges or a different radius",
    );
    const names = blendNames(op, body, sourceEdges, result, f.id);
    return { shape: result, names };
  }
}

function filletClipped(
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  ends: OpenEnd[],
  f: FilletFeature,
): ToolResult | null {
  const k = getKernel();
  const size = `radius ${f.radius}`;
  const advice = "try fewer edges or a different radius";
  const clipped = scoped((own) => {
    const split = splitAtEnds(body, sourceEdges, ends, f.id, own);
    if (!split) return null;
    const { piece, rest, kept } = split;
    const op = own(
      new k.BRepFilletAPI_MakeFillet(
        piece.shape,
        k.ChFi3d_FilletShape.ChFi3d_Rational,
      ),
    );
    for (const { edge } of kept)
      if (!op.Contour(edge)) op.Add_2(f.radius, edge);
    op.Build(progress());
    if (!op.IsDone()) return null;
    const filleted = own(op.Shape());
    rejectBadBlend(op, kept, filleted, piece.shape, "fillet", size, advice);
    const joined = fuseNamed(
      { shape: filleted, names: blendNames(op, piece, kept, filleted, f.id) },
      rest,
      f.id,
      `fillet of ${size} could not close its ends: ${advice}; the previous body has been kept`,
    );
    const merged = unifyTool(joined, f.id);
    if (merged !== joined) own(joined.shape);
    rejectBadBlend(null, [], merged.shape, body.shape, "fillet", size, advice);
    own.keep(merged.shape);
    return merged;
  });
  if (clipped) acquire(clipped.shape);
  return clipped;
}

export function filletFailure(
  op: any,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  radius: number,
): string {
  return scoped(() => {
    const chosen = new Set(refs.map((r) => shapeHash(byName.get(r.edgeName)!)));
    const names = new Map(
      [...byName].map(([name, edge]) => [shapeHash(edge), name]),
    );
    const added = new Set<string>();
    for (let i = 1; i <= op.NbFaultyContours(); i++) {
      const contour = op.FaultyContour(i);
      for (let j = 1; j <= op.NbEdges(contour); j++) {
        const edge = acquire(op.Edge(contour, j));
        const hash = shapeHash(edge);

        if (!chosen.has(hash)) added.add(names.get(hash) ?? "an unnamed edge");
      }
    }
    return added.size > 0
      ? `fillet of radius ${radius} failed on ${[...added].join(", ")}, a tangent continuation of the selected edges: try a smaller radius or fillet this edge before its neighbours`
      : `fillet of radius ${radius} failed: radius may be too large for the geometry`;
  });
}
