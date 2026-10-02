import { Type } from "typebox";
import type { EdgeRef, FaceRef, RefSignature } from "./model.js";
import type { route as defineRoute } from "./routes.js";
import { edgeRef, faceRef } from "./schema/features.js";

export function refRepairRoutes(route: typeof defineRoute) {
  return {
    tangentEdges: route<
      { edge: EdgeRef; beforeFeatureId?: string | undefined },
      { edges: EdgeRef[] }
    >()(
      "POST",
      "/projects/:id/tangent-edges",
      Type.Object({
        edge: edgeRef,
        beforeFeatureId: Type.Optional(Type.String()),
      }),
      "viewer",
    ),
    refSignature: route<{ ref: FaceRef | EdgeRef }, { sig: RefSignature }>()(
      "POST",
      "/projects/:id/features/:fid/signature",
      Type.Object({ ref: Type.Union([faceRef, edgeRef]) }),
      "viewer",
    ),
  };
}
