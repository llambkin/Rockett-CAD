import {
  bodyMadeBy,
  moduleBody,
  NAME_LENGTH,
  ROUTES,
  type CadDocument,
  type EvaluateResult,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";
import {
  BODY_ROUTE_MODULE,
  registerRouteModule,
  type RouteModule,
} from "./routeModules.js";
export function pruneGroups(
  doc: CadDocument,
  evaluation: EvaluateResult,
  position: number | undefined,
): boolean {
  const sketches = new Set(
    doc.features.filter((f) => f.type === "sketch").map((f) => f.id),
  );
  const failed = evaluation.featureStatuses.filter((s) => s.status === "error");
  const whole =
    position === undefined && doc.timelinePosition === doc.features.length;
  const made = new Set(evaluation.bodies.map((b) => b.bodyId));
  const built = (id: string) =>
    !whole || made.has(id) || failed.some((s) => bodyMadeBy(s.featureId, id));
  const before = JSON.stringify(doc.groups);
  for (const group of doc.groups)
    group.members = group.members.filter((id) =>
      group.kind === "sketch" ? sketches.has(id) : built(id),
    );
  return JSON.stringify(doc.groups) !== before;
}

export const bodyRoutes: RouteModule = {
  id: BODY_ROUTE_MODULE,
  mount(api) {
    api.projectMutation(ROUTES.updateGroups, async (doc, req) => {
      doc.groups = req.body.groups;
      return { label: "Edit groups" };
    });

    api.projectMutation(ROUTES.updateBody, async (doc, req) => {
      const { bodyId } = req.params;
      if (!Object.hasOwn(doc.bodyMeta, bodyId))
        throw new StoreError("body not found", "not_found");
      const meta = doc.bodyMeta[bodyId]!;
      const { name, color } = req.body;
      if (name !== undefined) {
        if (moduleBody(bodyId))
          throw new StoreError(
            `${meta.name} takes its name from its module`,
            "unprocessable",
          );
        const label = `Rename ${meta.name}`;
        meta.name = name.slice(0, NAME_LENGTH);
        return { label };
      }
      if (color === null) {
        delete meta.color;
        return { label: `Clear colour of ${meta.name}` };
      }
      meta.color = color!;
      return { label: `Colour ${meta.name}` };
    });
  },
};

registerRouteModule(bodyRoutes);
