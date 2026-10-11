import {
  StoreError,
  type CadDocument,
  type ProjectServiceContext,
  type ProjectServiceHandler,
} from "@rockett/plugin-api";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readBoardNets } from "../board.js";
import { linkOf, sourceTree } from "./upload.js";

export const BOARD_NETS = "rockett.kicad.boardNets";

const linkId = Type.String({ minLength: 1, maxLength: 128 });
export const refuse = (message: string) =>
  new StoreError(message, "unprocessable");

export async function linkAsset(
  doc: CadDocument,
  input: unknown,
  ctx: ProjectServiceContext,
  asset: "source" | "snapshot",
) {
  if (!Value.Check(linkId, input)) throw refuse("Invalid KiCad board link id");
  const { link } = linkOf(doc, input);
  return ctx.blobs.get(link[`${asset}Asset`]).catch((error) => {
    throw error instanceof StoreError && error.code === "not_found"
      ? refuse(`KiCad board ${asset} is missing; saved data was kept`)
      : error;
  });
}

export const boardNets: ProjectServiceHandler = async (doc, input, ctx) => {
  const bytes = await linkAsset(doc, input, ctx, "source");
  try {
    return { nets: readBoardNets(sourceTree(bytes)) };
  } catch (error) {
    throw refuse(
      `KiCad board source is invalid: ${error instanceof Error ? error.message : "unreadable"}`,
    );
  }
};
