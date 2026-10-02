import {
  faces as facesOf,
  getKernel,
  listToArray,
  scoped,
  type Shape,
} from "./kernel.js";
import {
  blendFaceName,
  finalizeNames,
  type NameMap,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";

export function blendNames(
  op: any,
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  featureId: string,
): NameMap {
  return scoped(() => {
    const k = getKernel();
    const provisional = new ShapeMap<string>();
    const bodyFaces = facesOf(body.shape);
    {
      for (const face of bodyFaces) {
        const name = body.names.get(face);
        if (!name || op.IsDeleted(face)) continue;
        const modified = listToArray(op.Modified(face));
        for (const mf of modified.length > 0 ? modified : [face]) {
          provisional.set(mf, name);
        }
      }
    }
    sourceEdges.forEach((se, i) => {
      const gen = listToArray(op.Generated(se.edge));
      gen.forEach((g, j) => {
        if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
          provisional.set(g, blendFaceName(featureId, i, j, gen.length));
        }
      });
    });
    return finalizeNames(result, provisional, featureId);
  });
}
