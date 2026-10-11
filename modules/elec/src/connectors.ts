import { Placement } from "@rockett/plugin-api";
import type { BoardNets } from "./boardNets.js";

type Vec3 = [number, number, number];
type Side = "front" | "back";

export type ConnectorSnapshot = {
  thickness: number;
  placement: Placement;
  footprints: readonly {
    uuid?: string | undefined;
    libId?: string | undefined;
    reference?: string | undefined;
    side?: string | undefined;
    pads: readonly { number?: string | undefined; x: number; y: number }[];
  }[];
  nets: BoardNets["nets"];
};

export type ConnectorFlags = Readonly<
  Record<string, { connector?: true; mating?: Vec3 }>
>;

export type Pin = { pad: string; net?: string; position: Vec3 };

export type PlacedFootprint = {
  footprintUuid: string;
  libId?: string | undefined;
  reference: string;
  side: Side;
  pins: Pin[];
};

export type Connector = {
  footprintUuid: string;
  reference: string;
  side: Side;
  suggested: Vec3;
  mating?: { direction: Vec3; source: "metadata" | "frame" };
  pins: Pin[];
};

const CONNECTOR_REFERENCE = /^(?:J|P|X|CN)/;

function vertical(libId: string | undefined) {
  const name = libId?.slice(libId.indexOf(":") + 1) ?? "";
  return name.split("_").includes("Vertical");
}

export function placedFootprints({
  thickness,
  placement,
  footprints,
  nets,
}: ConnectorSnapshot): PlacedFootprint[] {
  const netOf = new Map(
    nets.flatMap(({ name, members }) =>
      members.map(
        ({ footprintUuid, pad }) => [`${footprintUuid}\0${pad}`, name] as const,
      ),
    ),
  );
  return footprints.flatMap(({ uuid, libId, reference = "", side, pads }) => {
    if (!uuid || (side !== "front" && side !== "back")) return [];
    const z = side === "front" ? thickness : 0;
    return [
      {
        footprintUuid: uuid,
        libId,
        reference,
        side,
        pins: pads.flatMap(({ number, x, y }) => {
          if (!number) return [];
          const net = netOf.get(`${uuid}\0${number}`);
          return [
            {
              pad: number,
              ...(net !== undefined && { net }),
              position: Placement.applyToPoint(placement, [x, y, z]),
            },
          ];
        }),
      },
    ];
  });
}

export const isConnector = (
  { footprintUuid, reference }: PlacedFootprint,
  flags: ConnectorFlags,
) => !!flags[footprintUuid]?.connector || CONNECTOR_REFERENCE.test(reference);

export function connectors(
  snapshot: ConnectorSnapshot,
  flags: ConnectorFlags,
): Connector[] {
  return placedFootprints(snapshot).flatMap((placed) => {
    if (!isConnector(placed, flags)) return [];
    const { footprintUuid, libId, reference, side, pins } = placed;
    const flag = flags[footprintUuid];
    const suggested = Placement.applyToDirection(snapshot.placement, [
      0,
      0,
      side === "front" ? 1 : -1,
    ]);
    const mating: Connector["mating"] = flag?.mating
      ? {
          direction: Placement.applyToDirection(
            snapshot.placement,
            flag.mating,
          ),
          source: "frame",
        }
      : vertical(libId)
        ? { direction: suggested, source: "metadata" }
        : undefined;
    return [
      {
        footprintUuid,
        reference,
        side,
        suggested,
        ...(mating && { mating }),
        pins,
      },
    ];
  });
}
