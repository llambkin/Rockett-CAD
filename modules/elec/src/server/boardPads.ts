import type { Route, RouteModule } from "@rockett/plugin-api";
import { isConnector, placedFootprints, type Pin } from "../connectors.js";
import { boardSnapshot } from "./pinTable.js";

export type BoardPads = {
  nets: string[];
  footprints: {
    footprintUuid: string;
    reference: string;
    connector: boolean;
    pins: Pin[];
  }[];
};

export const padsRoute: Route<
  "/projects/:id/m/rockett/elec/boards/:linkId/pads",
  unknown,
  BoardPads
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/elec/boards/:linkId/pads",
};

export const padsModule: RouteModule = {
  id: "rockett.elec.pads",
  mount(api) {
    api.projectRoute(
      padsRoute,
      async (_doc, { params }, { services }): Promise<BoardPads> => {
        const snapshot = await boardSnapshot(services, params.linkId);
        return {
          nets: snapshot.nets.map(({ name }) => name),
          footprints: placedFootprints(snapshot).map((placed) => ({
            footprintUuid: placed.footprintUuid,
            reference: placed.reference,
            connector: isConnector(placed, {}),
            pins: placed.pins,
          })),
        };
      },
    );
  },
};
