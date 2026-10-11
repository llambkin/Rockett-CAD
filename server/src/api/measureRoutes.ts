import { ROUTES } from "@rockett/shared";
import { registerRouteModule } from "./routeModules.js";

registerRouteModule({
  id: "measure",
  mount(api) {
    api.projectRoute(ROUTES.measure, (doc, req) =>
      api.kernel.stateQuery(doc, { kind: "measure", request: req.body }),
    );
  },
});
