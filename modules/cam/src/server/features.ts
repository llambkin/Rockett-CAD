import type { RouteModuleApi, ServerContext } from "@rockett/plugin-api";
import type { FeaturesInput } from "../kernel/features.js";
import type { PlanFeatures } from "../plan/plan.js";
import { featuresRoute } from "../shared/document.js";
import { stockSetup } from "./generate.js";

export const FEATURES_JOB = "rockett.cam.features";

export function mountFeatures(
  api: RouteModuleApi,
  context: Pick<ServerContext, "bodies" | "startKernelJob">,
) {
  api.projectRoute(featuresRoute, async (doc, req, { user }) => {
    const found = await stockSetup(context, doc, req.params, user);
    if ("reason" in found) return found;
    const input: FeaturesInput = {
      setup: found.setup,
      bodies: found.bodies.map(({ id, bbox, brep, faceNames }) => ({
        id,
        bbox,
        brep,
        faceNames,
      })),
    };
    return (await context.startKernelJob(FEATURES_JOB, input)) as PlanFeatures;
  });
}
