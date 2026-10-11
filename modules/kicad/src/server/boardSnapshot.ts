import {
  placementSchema,
  type ProjectServiceHandler,
} from "@rockett/plugin-api";
import { Value } from "typebox/value";
import { snapshotSchema } from "../shared/data.js";
import { linkAsset, refuse } from "./boardNets.js";

export const BOARD = "rockett.kicad.board";

function parsed(bytes: Uint8Array) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export const boardSnapshot: ProjectServiceHandler = async (doc, input, ctx) => {
  const bytes = await linkAsset(doc, input, ctx, "snapshot");
  const placements = doc.features.flatMap((feature) =>
    feature.type === "rockett.kicad.board" &&
    !feature.suppressed &&
    "params" in feature &&
    feature.params.linkId === input
      ? [feature.params.placement]
      : [],
  );
  if (placements.length !== 1)
    throw refuse(
      placements.length
        ? "KiCad board link is placed by more than one board feature"
        : "KiCad board link is not placed by a board feature",
    );
  const [placement] = placements;
  if (!Value.Check(placementSchema, placement))
    throw refuse("KiCad board feature placement is invalid");
  const snapshot = parsed(bytes);
  if (!Value.Check(snapshotSchema, snapshot))
    throw refuse("KiCad board snapshot is not supported or valid");
  const { thickness, footprints } = snapshot.data;
  return {
    thickness,
    placement,
    footprints: footprints.map(({ uuid, libId, reference, side, pads }) => ({
      uuid,
      libId,
      reference,
      side,
      pads: pads.map(({ number, x, y }) => ({ number, x, y })),
    })),
  };
};
