import type {
  ProjectServiceContext,
  ProjectServiceHandler,
  ProjectServices,
} from "@rockett/plugin-api";
import { createRegistry, REGISTRY_ID, type CadDocument } from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";

const services = createRegistry<{ id: string; handler: ProjectServiceHandler }>(
  "module service",
  (service) => service.id,
);

export function provideService(
  moduleId: string,
  id: string,
  handler: ProjectServiceHandler,
) {
  if (!id.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(id))
    throw new Error(
      `module service ${id} must start with ${moduleId}. and name a valid id`,
    );
  return services.register({ id, handler });
}

export function projectServices(
  doc: CadDocument,
  ctx: ProjectServiceContext,
): ProjectServices {
  const user = { ...ctx.user };
  const get = ctx.blobs.get;
  return {
    get(id) {
      if (!services.get(id)) return undefined;
      return async (input) => {
        const service = services.get(id);
        if (!service)
          throw new StoreError(
            `Module service ${id} is unavailable`,
            "unprocessable",
          );
        return service.handler(doc, input, {
          user: { ...user },
          blobs: { get },
        });
      };
    },
  };
}
