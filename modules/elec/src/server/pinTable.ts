import {
  placementSchema,
  type ProjectServices,
  type Route,
  type RouteModule,
} from "@rockett/plugin-api";
import { Type } from "typebox";
import { boardNetsSchema, provided } from "../boardNets.js";
import {
  connectors,
  type Connector,
  type ConnectorSnapshot,
} from "../connectors.js";

const text = Type.Optional(Type.String());
const boardSchema = Type.Object({
  thickness: Type.Number({ exclusiveMinimum: 0 }),
  placement: placementSchema,
  footprints: Type.Array(
    Type.Object({
      uuid: text,
      libId: text,
      reference: text,
      side: text,
      pads: Type.Array(
        Type.Object({ number: text, x: Type.Number(), y: Type.Number() }),
      ),
    }),
  ),
});

export async function boardSnapshot(
  services: ProjectServices,
  linkId: string,
): Promise<ConnectorSnapshot> {
  const board = await provided(services, "board", boardSchema, "board", linkId);
  const { nets } = await provided(
    services,
    "boardNets",
    boardNetsSchema,
    "board nets",
    linkId,
  );
  return { ...board, nets };
}

const field = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const mm = (value: number) => String(Math.round(value * 1e4) / 1e4 + 0);

export function pinTable(listed: readonly Connector[]) {
  const rows = [
    ["Reference", "Pin", "Net", "X", "Y", "Z"],
    ...listed.flatMap(({ reference, pins }) =>
      pins.map(({ pad, net = "", position }) => [
        reference,
        pad,
        net,
        ...position.map(mm),
      ]),
    ),
  ];
  return rows.map((row) => `${row.map(field).join(",")}\r\n`).join("");
}

export const pinsRoute: Route<
  "/projects/:id/m/rockett/elec/boards/:linkId/pins",
  unknown,
  string
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/elec/boards/:linkId/pins",
};

export const pinsModule: RouteModule = {
  id: "rockett.elec.pins",
  mount(api) {
    api.projectRoute(pinsRoute, async (_doc, { params }, { services }) =>
      pinTable(connectors(await boardSnapshot(services, params.linkId), {})),
    );
  },
};
