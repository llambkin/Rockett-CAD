import { rejectEmptyFilletContours } from "./nativeFillet.js";
import { filletFailure } from "./nativeFillet.js";
import { nativeOtherEnds, nativeSourceEnd } from "./nativeOtherEnds.js";
import { mixedFilletHistory } from "./mixedFilletHistory.js";
import { contourEndReferences } from "./blendEnds.js";
import { LINEAR_TOL, type Vec3, type EdgeRef } from "@rockett/shared";
import { filletBetweenPlanes, type PlaneSide } from "./blendModule.js";
import { planeSides, type PlanarSide } from "./blendSides.js";
import { rejectSewnBlend } from "./blendValidity.js";
import { NoCorner, vertexPoint, type ToolResult } from "./featureState.js";
import { V } from "./frames.js";
import {
  bboxOf,
  acquire,
  edges,
  faces,
  vertices,
  explore,
  getKernel,
  scoped,
  progress,
  vec,
  type Shape,
  type Own,
} from "./kernel.js";
import { blendFaceName, finalizeNames, type NamedBody } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { planarFilletSurface } from "./planarFilletSurface.js";
import { sharedFilletBoundaries } from "./filletBoundaries.js";
import { filletEndCurves, type GuidePatch } from "./filletEndCurves.js";

export type BlendStrip = {
  kind: "fillet" | "chamfer";
  size: number;
  face(
    points: [Vec3, Vec3],
    sides: [PlanarSide, PlanarSide],
    axis: Vec3,
    own: Own,
    bounds: ReturnType<typeof bboxOf>,
  ): Shape;
  accepts?(chain: { edge: Shape }[], sides: PlanarSide[][], own: Own): boolean;
  sides(edge: Shape, original: Shape[], own: Own): PlanarSide[] | null;
};

export function planeFilletSection(
  points: [Vec3, Vec3],
  sides: [PlaneSide, PlaneSide],
  radius: number,
) {
  const concave = sides.every(
    (side, i) => V.dot(side.into, sides[1 - i]!.normal) > 0,
  );
  const orient = (side: PlaneSide) => ({
    ...side,
    normal: concave ? V.scale(side.normal, -1) : side.normal,
  });
  const section = filletBetweenPlanes(
    points,
    [orient(sides[0]), orient(sides[1])],
    radius,
  );
  if (!section)
    throw new NoCorner(
      "no sharp corner to fillet: the faces meet smoothly there",
    );
  return section;
}

function filletStrip(radius: number): BlendStrip {
  return {
    kind: "fillet",
    size: radius,
    sides: planeSides,
    face(points, sides, axis, own, bounds) {
      const section = planeFilletSection(points, sides, radius);
      return planarFilletSurface(section, axis, radius, own, bounds).face;
    },
  };
}

function surfaces(
  selected: { edge: Shape }[],
  source: Shape[],
  strip: BlendStrip,
  own: Own,
  body: Shape,
  contour: any,
): GuidePatch[] {
  const k = getKernel(),
    bounds = bboxOf(body, false);
  return selected.map(({ edge: originalEdge }) => {
    const c = contour.Contour(originalEdge),
      occurrences = Array.from({ length: contour.NbEdges(c) }, (_, i) =>
        own(contour.Edge(c, i + 1)),
      ).filter((edge) => edge.IsSame(originalEdge));
    if (occurrences.length !== 1)
      throw new Error(
        "the module guide has missing or duplicate contour ownership",
      );
    const edge = occurrences[0]!;

    const sides = strip.sides(edge, source, own);
    if (!sides)
      throw new Error("the module guide must have two planar neighbors");
    const points: [Vec3, Vec3] = [
      vertexPoint(own(k.TopExp.FirstVertex(edge, true))),
      vertexPoint(own(k.TopExp.LastVertex(edge, true))),
    ];
    const curve = own(new k.BRepAdaptor_Curve_2(edge)),
      direction = own(vec(0, 0, 0));
    curve.D1(curve.FirstParameter(), own(new k.gp_Pnt_1()), direction);
    const axis = V.scale(
      V.normalize([direction.X(), direction.Y(), direction.Z()]),
      edge.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1,
    );
    return {
      edge,
      points,
      neighbors: sides.map((side) => side.face),
      face: strip.face(points, [sides[0]!, sides[1]!], axis, own, bounds),
    };
  });
}

export type Cell = { face: Shape; name: string | undefined; made: boolean };
export function assembleBlend(
  cells: Cell[],
  body: NamedBody,
  strip: Pick<BlendStrip, "kind" | "size">,
  featureId: string,
  own: Own,
) {
  const k = getKernel();
  const sew = own(
    new k.BRepBuilderAPI_Sewing(LINEAR_TOL, true, true, true, false),
  );
  cells.forEach((cell) => sew.Add(cell.face));
  sew.Perform(progress());
  if (sew.NbFreeEdges() || sew.NbMultipleEdges())
    throw new Error(
      `the ${strip.kind} left an invalid shape: its trimmed faces do not close; the previous body has been kept`,
    );
  const solid = own(new k.BRepBuilderAPI_MakeSolid_1());
  for (const shell of explore(own(sew.SewedShape()), "shell"))
    solid.Add(own(k.TopoDS.Shell_1(shell)));
  const result = own(solid.Solid());
  if (!k.BRepLib.OrientClosedSolid(result))
    throw new Error(
      `the ${strip.kind} left an invalid shape: its solid could not be oriented`,
    );
  const mapped = cells.map((cell) => ({
    ...cell,
    face: sew.IsModified(cell.face) ? own(sew.Modified(cell.face)) : cell.face,
  }));
  rejectSewnBlend(
    result,
    body.shape,
    mapped.filter((cell) => cell.made).map((cell) => cell.face),
    strip.kind,
    strip.size,
  );
  const provisional = new ShapeMap<string>();
  own({ delete: () => provisional.release() });
  for (const { face, name } of mapped) if (name) provisional.set(face, name);
  return {
    shape: result,
    names: finalizeNames(result, provisional, featureId),
  };
}

export function planarFillet(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  radius: number,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult | null {
  return planarBlend(
    body,
    selected,
    filletStrip(radius),
    featureId,
    byName,
    refs,
  );
}

function blendFailure(
  strip: BlendStrip,
  contour: any,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
) {
  return strip.kind === "fillet"
    ? filletFailure(contour, byName, refs, strip.size)
    : `chamfer of distance ${strip.size} failed: distance may be too large for the geometry`;
}

export function planarBlend(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  strip: BlendStrip,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
): ToolResult | null {
  const result = scoped((own) => {
    const original = faces(body.shape).map(own);
    const sides = selected.map(({ edge }) => strip.sides(edge, original, own));
    if (sides.every((entry) => !entry)) return null;
    const topology = ownedFilletTopology(
      body,
      selected,
      original,
      sides,
      strip,
      featureId,
      byName,
      refs,
      own,
    );
    if (!topology) return null;
    const {
      source,
      history,
      planeIndices,
      planeChosen,
      planeTerminations,
      contour,
    } = topology;
    const patches = surfaces(
      planeChosen,
      source,
      strip,
      own,
      body.shape,
      contour,
    );
    const nativeEnds = history
      ? nativeOtherEnds(history, patches, planeIndices, own)
      : [];
    const { ends, corners } = filletEndCurves(
      source,
      patches,
      strip.size,
      own,
      planeTerminations,
      nativeEnds,
    );
    const { replacements, madePatches } = sharedFilletBoundaries(
      source,
      patches,
      ends,
      own,
      () => {
        throw new Error(blendFailure(strip, contour, byName, refs));
      },
      history?.source.map((entry) => entry.original) ?? [],
      history?.contacts ?? [],
    );
    const cells = filletCells(
      body,
      original,
      source,
      history,
      replacements,
      madePatches,
      corners,
      planeIndices,
      featureId,
      selected.length,
    );
    const assembled = assembleBlend(cells, body, strip, featureId, own);
    return { ...assembled, shape: own.keep(assembled.shape) };
  });
  if (result) acquire(result.shape);
  return result;
}

export function copiedBody(body: NamedBody, original: Shape[], own: Own) {
  const k = getKernel();
  const copy = own(new k.BRepBuilderAPI_Copy_2(body.shape, false, false));
  const copied = (shape: Shape) =>
    own(own(copy.ModifiedShape(shape)).Oriented(shape.Orientation_1()));
  return {
    shape: own(copy.Shape()),
    source: original.map((face) => own(k.TopoDS.Face_1(copied(face)))),
    edge: (edge: Shape) => own(k.TopoDS.Edge_1(copied(edge))),
  };
}

function ownedFilletTopology(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  original: Shape[],
  eligibility: (PlanarSide[] | null)[],
  strip: BlendStrip,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  own: Own,
) {
  const k = getKernel();
  const copy = copiedBody(body, original, own);
  const source = copy.source;
  const chosen = selected.map(({ edge, name }) => ({
    edge: copy.edge(edge),
    name,
  }));
  const contour = own(
    new k.BRepFilletAPI_MakeFillet(
      copy.shape,
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    ),
  );
  chosen.forEach(({ edge }) => {
    if (!contour.Contour(edge)) contour.Add_2(strip.size, edge);
  });
  rejectEmptyFilletContours(contour, chosen);
  if (
    strip.kind === "chamfer" &&
    !chamferChain(contour, chosen, eligibility, source, strip, own)
  )
    return null;
  const terminations = contourEndReferences(contour, chosen, new Set());
  const mixed = eligibility.some((sides) => !sides);
  const needsNative = mixed || nativeBoundaryTransition(chosen, source, own);
  if (needsNative) {
    const propagated = contourContinuations(contour, chosen, own);
    chosen.push(...propagated);
    eligibility.push(
      ...propagated.map(({ edge }) => strip.sides(edge, source, own)),
    );
  }
  const history = needsNative
    ? mixedFilletHistory(
        contour,
        chosen,
        eligibility.map(Boolean),
        featureId,
        strip.size,
        own,
        new Map([...byName].map(([name, edge]) => [name, copy.edge(edge)])),
        refs,
        source,
      )
    : null;
  const planeIndices = chosen.flatMap((_, index) =>
    eligibility[index] ? [index] : [],
  );
  const planeChosen = planeIndices.map((index) => chosen[index]!);
  const planeTerminations = terminations.flatMap((end) => {
    const selection = planeIndices.indexOf(end.selection);
    return selection < 0 ? [] : [{ ...end, selection }];
  });
  return {
    source,
    history,
    planeIndices,
    planeChosen,
    planeTerminations,
    contour,
  };
}

function chamferChain(
  contour: any,
  chosen: { edge: Shape; name: string }[],
  eligibility: (PlanarSide[] | null)[],
  source: Shape[],
  strip: BlendStrip,
  own: Own,
) {
  const propagated = contourContinuations(contour, chosen, own);
  chosen.push(...propagated);
  eligibility.push(
    ...propagated.map(({ edge }) => strip.sides(edge, source, own)),
  );
  const sides = eligibility.flatMap((entry) => (entry ? [entry] : []));
  return (
    sides.length === chosen.length &&
    !nativeBoundaryTransition(chosen, source, own) &&
    Boolean(strip.accepts?.(chosen, sides, own))
  );
}

export function contourContinuations(
  contour: any,
  chosen: { edge: Shape }[],
  own: Own,
) {
  const propagated: { edge: Shape; name: string }[] = [];
  for (let c = 1; c <= contour.NbContours(); c++) {
    for (let j = 1; j <= contour.NbEdges(c); j++) {
      const edge = own(contour.Edge(c, j));
      if (chosen.concat(propagated).some((entry) => entry.edge.IsSame(edge)))
        continue;
      propagated.push({ edge, name: "" });
    }
  }
  return propagated;
}

function nativeBoundaryTransition(
  chosen: { edge: Shape }[],
  source: Shape[],
  own: Own,
) {
  return chosen.some(({ edge }) =>
    vertices(edge)
      .map(own)
      .some((vertex) => {
        if (
          source.some(
            (face) =>
              !chosen.some(({ edge: other }) =>
                edges(face)
                  .map(own)
                  .some((boundary) => boundary.IsSame(other)),
              ) && nativeSourceEnd(face, vertex, own),
          )
        )
          return true;
        const incident = chosen.filter(({ edge: other }) =>
          vertices(other)
            .map(own)
            .some((endpoint) => endpoint.IsSame(vertex)),
        );
        if (incident.length < 3) return false;
        const planes = source.filter((face) =>
          vertices(face)
            .map(own)
            .some((endpoint) => endpoint.IsSame(vertex)),
        );
        return planes.length !== 3;
      }),
  );
}

function filletCells(
  body: NamedBody,
  original: Shape[],
  source: Shape[],
  history: ReturnType<typeof mixedFilletHistory> | null,
  replacements: { original: Shape; face: Shape }[],
  madePatches: Shape[],
  corners: Shape[],
  planeIndices: number[],
  featureId: string,
  selectedCount: number,
): Cell[] {
  return replacements
    .flatMap(({ original: old, face: rebuilt }) =>
      (history?.replace(old) ?? [rebuilt]).map((face) => ({
        face,
        name: body.names.get(original[source.findIndex((s) => s.IsSame(old))]!),
        made: false,
      })),
    )
    .concat(
      madePatches.map((face, index) => ({
        face,
        name:
          planeIndices[index]! < selectedCount
            ? blendFaceName(featureId, planeIndices[index]!)
            : undefined,
        made: true,
      })),
      corners.map((face) => ({ face, name: undefined, made: true })),
      history?.cells ?? [],
    );
}
