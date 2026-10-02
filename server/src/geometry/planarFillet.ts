import { rejectEmptyFilletContours } from "./nativeFillet.js";
import { filletFailure } from "./nativeFillet.js";
import { nativeOtherEnds, nativeSourceEnd } from "./nativeOtherEnds.js";
import { mixedFilletHistory } from "./mixedFilletHistory.js";
import { contourEndReferences } from "./blendEnds.js";
import { LINEAR_TOL, type Vec3, type EdgeRef } from "@rockett/shared";
import { filletBetweenPlanes, type PlaneSide } from "./blendModule.js";
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
  planarFacePlane,
  progress,
  vec,
  type Shape,
  type Own,
} from "./kernel.js";
import { blendFaceName, finalizeNames, type NamedBody } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { planeBoundarySample } from "./planeBoundary.js";
import { planarFilletSurface } from "./planarFilletSurface.js";
import { sharedFilletBoundaries } from "./filletBoundaries.js";
import { filletEndCurves, type GuidePatch } from "./filletEndCurves.js";

type PlanarSide = PlaneSide & { face: Shape };
function planeSides(
  edge: Shape,
  original: Shape[],
  own: Own,
): PlanarSide[] | null {
  const k = getKernel();
  const guide = own(new k.BRepAdaptor_Curve_2(edge));
  if (guide.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) return null;
  const neighboring = original.flatMap((face) => {
    const occurrence = edges(face)
      .map(own)
      .find((e) => e.IsSame(edge));
    return occurrence ? [{ face, occurrence }] : [];
  });
  if (neighboring.length !== 2) return null;
  const sides: PlanarSide[] = [];
  for (const { face, occurrence } of neighboring) {
    const plane = planarFacePlane(face);
    if (!plane) return null;
    sides.push({
      face,
      normal: plane.normal,
      into: planeBoundarySample(occurrence, plane.normal, own).into,
    });
  }
  return sides;
}

function surfaces(
  selected: { edge: Shape }[],
  source: Shape[],
  radius: number,
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

    const sides = planeSides(edge, source, own);
    if (!sides)
      throw new Error("the module guide must have two planar neighbors");
    const points: [Vec3, Vec3] = [
      vertexPoint(own(k.TopExp.FirstVertex(edge, true))),
      vertexPoint(own(k.TopExp.LastVertex(edge, true))),
    ];
    if (points.length !== 2)
      throw new Error("the fillet edge has no two distinct ends");
    const concave = sides.every(
      (side, i) => V.dot(side.into, sides[1 - i]!.normal) > 0,
    );
    const orient = (side: PlanarSide) => ({
      ...side,
      normal: concave ? V.scale(side.normal, -1) : side.normal,
    });
    const oriented: [PlaneSide, PlaneSide] = [
      orient(sides[0]!),
      orient(sides[1]!),
    ];
    const section = filletBetweenPlanes(points, oriented, radius);
    if (!section)
      throw new NoCorner(
        "no sharp corner to fillet: the faces meet smoothly there",
      );
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
      face: planarFilletSurface(section, axis, radius, own, bounds).face,
    };
  });
}

type Cell = { face: Shape; name: string | undefined; made: boolean };
function assembleFillet(
  cells: Cell[],
  body: NamedBody,
  radius: number,
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
      "the fillet left an invalid shape: its trimmed faces do not close; the previous body has been kept",
    );
  const solid = own(new k.BRepBuilderAPI_MakeSolid_1());
  for (const shell of explore(own(sew.SewedShape()), "shell"))
    solid.Add(own(k.TopoDS.Shell_1(shell)));
  const result = own(solid.Solid());
  if (!k.BRepLib.OrientClosedSolid(result))
    throw new Error(
      "the fillet left an invalid shape: its solid could not be oriented",
    );
  const mapped = cells.map((cell) => ({
    ...cell,
    face: sew.IsModified(cell.face) ? own(sew.Modified(cell.face)) : cell.face,
  }));
  rejectSewnBlend(
    result,
    body.shape,
    mapped.filter((cell) => cell.made).map((cell) => cell.face),
    radius,
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
  const result = scoped((own) => {
    const original = faces(body.shape).map(own),
      eligibility = selected.map(({ edge }) => planeSides(edge, original, own));
    if (eligibility.every((sides) => !sides)) return null;
    const {
      source,
      history,
      planeIndices,
      planeChosen,
      planeTerminations,
      contour,
    } = ownedFilletTopology(
      body,
      selected,
      original,
      eligibility,
      radius,
      featureId,
      byName,
      refs,
      own,
    );
    const patches = surfaces(
      planeChosen,
      source,
      radius,
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
      radius,
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
        throw new Error(filletFailure(contour, byName, refs, radius));
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
    const assembled = assembleFillet(cells, body, radius, featureId, own);
    return { ...assembled, shape: own.keep(assembled.shape) };
  });
  if (result) acquire(result.shape);
  return result;
}

function ownedFilletTopology(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  original: Shape[],
  eligibility: (PlanarSide[] | null)[],
  radius: number,
  featureId: string,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  own: Own,
) {
  const k = getKernel();
  const copy = own(new k.BRepBuilderAPI_Copy_2(body.shape, false, false));
  const copied = (shape: Shape) =>
    own(own(copy.ModifiedShape(shape)).Oriented(shape.Orientation_1()));
  const source = original.map((face) => own(k.TopoDS.Face_1(copied(face))));
  const chosen = selected.map(({ edge, name }) => ({
    edge: own(k.TopoDS.Edge_1(copied(edge))),
    name,
  }));
  const contour = own(
    new k.BRepFilletAPI_MakeFillet(
      own(copy.Shape()),
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    ),
  );
  chosen.forEach(({ edge }) => {
    if (!contour.Contour(edge)) contour.Add_2(radius, edge);
  });
  rejectEmptyFilletContours(contour, chosen);
  const terminations = contourEndReferences(contour, chosen, new Set());
  const mixed = eligibility.some((sides) => !sides);
  const needsNative = mixed || nativeBoundaryTransition(chosen, source, own);
  if (needsNative) {
    const propagated = contourContinuations(contour, chosen, own);
    chosen.push(...propagated);
    eligibility.push(
      ...propagated.map(({ edge }) => planeSides(edge, source, own)),
    );
  }
  const history = needsNative
    ? mixedFilletHistory(
        contour,
        chosen,
        eligibility.map(Boolean),
        featureId,
        radius,
        own,
        new Map(
          [...byName].map(([name, edge]) => [
            name,
            own(k.TopoDS.Edge_1(copied(edge))),
          ]),
        ),
        refs,
        source,
      )
    : null;
  const planeIndices = chosen.flatMap((chosen, index) =>
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

function contourContinuations(
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
              !chosen.some(({ edge }) =>
                edges(face)
                  .map(own)
                  .some((boundary) => boundary.IsSame(edge)),
              ) && nativeSourceEnd(face, vertex, own),
          )
        )
          return true;
        const incident = chosen.filter(({ edge }) =>
          vertices(edge)
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
    .flatMap(({ original: old, face }) =>
      (history?.replace(old) ?? [face]).map((face) => ({
        face,
        name: body.names.get(
          original[source.findIndex((face) => face.IsSame(old))]!,
        ),
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
