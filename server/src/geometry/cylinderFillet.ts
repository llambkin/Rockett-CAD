import { LINEAR_TOL, UNIT_DOT_TOL, type EdgeRef } from "@rockett/shared";
import { filletSection } from "./blendModule.js";
import {
  chamferSides,
  circleSides,
  cylinderOf,
  ellipseSides,
  torusSides,
} from "./blendSides.js";
import { ellipseGuide } from "./ellipseFillet.js";
import type { ToolResult } from "./featureState.js";
import { V } from "./frames.js";
import {
  acquire,
  faces,
  getKernel,
  kernelCall,
  scoped,
  type Own,
  type Shape,
} from "./kernel.js";
import {
  blendFaceName,
  finalizeNames,
  unnamedPrefix,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import {
  contourContinuations,
  planarBlend,
  type BlendStrip,
} from "./planarFillet.js";
import { planarFilletSurface } from "./planarFilletSurface.js";
import { arcTorusStrip, closedBlend, torusGuide } from "./torusFillet.js";

function sameCylinder(a: Shape, b: Shape, own: Own) {
  const [first, second] = [cylinderOf(a, own), cylinderOf(b, own)];
  if (!first || !second) return false;
  const offset = V.sub(second.origin, first.origin);
  return (
    Math.abs(first.radius - second.radius) <= LINEAR_TOL &&
    1 - Math.abs(V.dot(first.axis, second.axis)) <= UNIT_DOT_TOL &&
    V.norm(V.sub(offset, V.scale(first.axis, V.dot(offset, first.axis)))) <=
      LINEAR_TOL
  );
}

function cylinderStrip(radius: number): BlendStrip {
  const made: Shape[] = [];
  return {
    kind: "fillet",
    size: radius,
    sides: chamferSides,
    face(points, sides, axis, own, bounds) {
      const section = filletSection(points, sides, radius);
      if (!section)
        throw new Error("the module declines this plane-cylinder fillet");
      const { face } = planarFilletSurface(section, axis, radius, own, bounds);
      const twin = made.find((other) => sameCylinder(other, face, own));
      if (!twin) {
        made.push(face);
        return face;
      }
      const k = getKernel();
      return own(
        k.TopoDS.Face_1(
          own(own(new k.BRepBuilderAPI_Copy_2(twin, false, false)).Shape()),
        ),
      );
    },
  };
}

function filletChain(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  radius: number,
  own: Own,
) {
  const k = getKernel(),
    contour = own(
      new k.BRepFilletAPI_MakeFillet(
        body.shape,
        k.ChFi3d_FilletShape.ChFi3d_Rational,
      ),
    );
  selected.forEach(({ edge }) => {
    if (!contour.Contour(edge)) contour.Add_2(radius, edge);
  });
  return [...selected, ...contourContinuations(contour, selected, own)];
}

function chainBlend(
  body: NamedBody,
  chain: { edge: Shape; name: string }[],
  radius: number,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  own: Own,
) {
  const original = faces(body.shape).map(own);
  const along = (sides: typeof chamferSides) =>
    chain.every(({ edge }) => sides(edge, original, own));
  if (along(chamferSides))
    return planarBlend(
      body,
      chain,
      cylinderStrip(radius),
      featureId,
      byName,
      refs,
    );
  const closed = along(torusSides)
    ? torusGuide(radius)
    : along(ellipseSides) && ellipseGuide(radius);
  if (closed)
    return closedBlend(
      body,
      chain,
      { kind: "fillet", size: radius },
      featureId,
      closed,
      own,
    );
  return along(circleSides)
    ? planarBlend(body, chain, arcTorusStrip(radius), featureId, byName, refs)
    : null;
}

function unnamePropagated(
  result: ToolResult,
  featureId: string,
  chained: number,
  selected: number,
) {
  if (chained === selected) return result;
  const propagated = new Set(
    Array.from({ length: chained - selected }, (_, i) =>
      blendFaceName(featureId, selected + i),
    ),
  );
  const provisional = new ShapeMap<string>();
  try {
    for (const [face, name] of result.names.entries())
      if (!propagated.has(name) && !name.startsWith(unnamedPrefix(featureId)))
        provisional.set(face, name);
    return {
      ...result,
      names: finalizeNames(result.shape, provisional, featureId),
    };
  } finally {
    provisional.release();
    result.names.release();
  }
}

export function cylinderFillet(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  radius: number,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult | null {
  try {
    const built = kernelCall("fillet", () =>
      scoped((own) => {
        const chain = filletChain(body, selected, radius, own);
        const result = chainBlend(
          body,
          chain,
          radius,
          featureId,
          byName,
          refs,
          own,
        );
        if (!result) return null;
        own.keep(result.shape);
        return unnamePropagated(
          result,
          featureId,
          chain.length,
          selected.length,
        );
      }),
    );
    if (built) acquire(built.shape);
    return built;
  } catch {
    return null;
  }
}
