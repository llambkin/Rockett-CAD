import { storedSurfaceCurve } from "./storedSurfaceCurve.js";
import type { EdgeRef } from "@rockett/shared";
import { filletFailure } from "./nativeFillet.js";
import { rejectLooseBlend } from "./blendValidity.js";
import assert from "node:assert/strict";
import {
  getKernel,
  listToArray,
  vertices,
  edges,
  progress,
  type Shape,
  type Own,
} from "./kernel.js";
import { looseBlend } from "./blendValidity.js";
import { blendFaceName } from "./naming.js";

export function mixedFilletHistory(
  operation: any,
  chosen: { edge: Shape; name: string }[],
  eligible: boolean[],
  featureId: string,
  radius: number,
  own: Own,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  sourceFaces: Shape[],
) {
  const k = getKernel();
  operation.Build(progress());
  if (!operation.IsDone())
    throw new Error(filletFailure(operation, byName, refs, radius));
  const result = own(operation.Shape());
  rejectLooseBlend(looseBlend(operation, chosen, result), "fillet");
  const faceHistory = (shape: Shape, method: "Generated" | "Modified") =>
    listToArray(operation[method](shape))
      .map(own)
      .filter((face) => face.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE)
      .map((face) => own(k.TopoDS.Face_1(face)));
  const generated = chosen.map(({ edge }) => faceHistory(edge, "Generated"));
  const unique = otherHistory(generated, chosen, eligible, featureId);
  const corners = cornerHistory(chosen, generated, faceHistory, own);
  const contacts = sourceContacts(
    sourceFaces,
    chosen,
    eligible,
    generated,
    faceHistory,
    own,
    operation,
  );
  const source = sourceDomains(
    sourceFaces,
    chosen,
    eligible,
    faceHistory,
    operation,
    own,
  );

  return {
    generated,
    contacts,
    cells: unique.concat(corners),
    source,
    replace: (original: Shape) =>
      source.find((entry) => entry.original.IsSame(original))?.faces ?? null,
  };
}

type FaceHistory = (shape: Shape, method: "Generated" | "Modified") => Shape[];
function cornerHistory(
  chosen: { edge: Shape; name: string }[],
  generated: Shape[][],
  faceHistory: FaceHistory,
  own: Own,
) {
  return chosen
    .flatMap(({ edge }) =>
      vertices(edge)
        .map(own)
        .flatMap((vertex) =>
          faceHistory(vertex, "Generated").map((face) => ({
            face,
            from: [vertex],
            name: undefined,
            made: true,
          })),
        ),
    )
    .filter(
      (cell, index, all) =>
        !all
          .slice(0, index)
          .some((previous) => previous.face.IsSame(cell.face)) &&
        !generated.flat().some((previous) => previous.IsSame(cell.face)),
    );
}

function sourceContacts(
  sourceFaces: Shape[],
  chosen: { edge: Shape; name: string }[],
  eligible: boolean[],
  generated: Shape[][],
  faceHistory: FaceHistory,
  own: Own,
  operation: any,
) {
  const k = getKernel();
  return chosen.flatMap(({ edge: old }, index) => {
    if (eligible[index]) return [];
    return sourceFaces
      .filter(
        (face) =>
          edges(face)
            .map(own)
            .some((edge) => edge.IsSame(old)) &&
          chosen.some(
            ({ edge }, i) =>
              eligible[i] &&
              edges(face)
                .map(own)
                .some((candidate) => candidate.IsSame(edge)),
          ),
      )
      .map((face) => {
        const candidates = faceHistory(face, "Modified").flatMap((modified) =>
          edges(modified)
            .map(own)
            .filter((edge) =>
              generated[index]!.some((other) =>
                edges(other)
                  .map(own)
                  .some((candidate) => candidate.IsSame(edge)),
              ),
            ),
        );
        const unique = candidates.filter(
          (edge, i) =>
            candidates.findIndex((other) => other.IsSame(edge)) === i,
        );
        if (!unique.length && operation.IsDeleted(old))
          return { face, old, edge: null };
        assert.equal(unique.length, 1);
        const edge = unique[0]!;
        const location = own(new k.TopLoc_Location_1());
        const surface = own(k.BRep_Tool.Surface_1(face, location));
        storedSurfaceCurve(edge, surface, location, own);
        return { face, old, edge };
      });
  });
}

function sourceDomains(
  sourceFaces: Shape[],
  chosen: { edge: Shape; name: string }[],
  eligible: boolean[],
  faceHistory: FaceHistory,
  operation: any,
  own: Own,
) {
  return sourceFaces
    .filter(
      (face) =>
        !chosen.some(
          ({ edge }, index) =>
            eligible[index] &&
            edges(face)
              .map(own)
              .some((candidate) => candidate.IsSame(edge)),
        ),
    )
    .map((original) => {
      const modified = faceHistory(original, "Modified");
      return {
        original,
        faces: modified.length
          ? modified
          : operation.IsDeleted(original)
            ? []
            : [original],
      };
    });
}

function otherHistory(
  generated: Shape[][],
  chosen: { edge: Shape; name: string }[],
  eligible: boolean[],
  featureId: string,
) {
  const planes = generated.flatMap((faces, index) =>
    eligible[index] ? faces : [],
  );
  const other: {
    face: Shape;
    name: string | undefined;
    made: boolean;
    from: Shape[];
  }[] = generated.flatMap((faces, index) =>
    eligible[index]
      ? []
      : faces.map((face, part) => ({
          face,
          name: chosen[index]!.name
            ? blendFaceName(featureId, index, part, faces.length)
            : undefined,
          made: true,
          from: [chosen[index]!.edge],
        })),
  );
  assert(
    other.every(({ face }) => !planes.some((plane) => plane.IsSame(face))),
  );
  const unique = other.filter(
    (cell, index) =>
      !other
        .slice(0, index)
        .some((previous) => previous.face.IsSame(cell.face)),
  );
  return unique;
}
