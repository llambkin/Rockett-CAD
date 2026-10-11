import {
  StoreError,
  type ProjectServices,
  type Route,
  type RouteModule,
} from "@rockett/plugin-api";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const PROVIDER = "rockett.kicad";
const id = Type.String({ minLength: 1 });
export const boardNetsSchema = Type.Object({
  nets: Type.Array(
    Type.Object({
      name: id,
      members: Type.Array(
        Type.Object({
          footprintUuid: id,
          reference: Type.String(),
          pad: Type.String(),
        }),
      ),
    }),
  ),
});
export type BoardNets = Static<typeof boardNetsSchema>;

export async function provided<S extends TSchema>(
  services: ProjectServices,
  service: string,
  schema: S,
  label: string,
  input: string,
): Promise<Static<S>> {
  const call = services.get(`${PROVIDER}.${service}`);
  if (!call)
    throw new StoreError(`Requires module ${PROVIDER}`, "unprocessable");
  const result = await call(input);
  if (!Value.Check(schema, result))
    throw new StoreError(
      `Module ${PROVIDER} returned invalid ${label}`,
      "unprocessable",
    );
  return result;
}

export const netsRoute: Route<
  "/projects/:id/m/rockett/elec/boards/:linkId/nets",
  unknown,
  BoardNets
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/elec/boards/:linkId/nets",
};

export const netsModule: RouteModule = {
  id: "rockett.elec.nets",
  mount(api) {
    api.projectRoute(netsRoute, (_doc, { params }, { services }) =>
      provided(
        services,
        "boardNets",
        boardNetsSchema,
        "board nets",
        params.linkId,
      ),
    );
  },
};
