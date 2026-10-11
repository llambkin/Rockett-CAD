import type { Box, Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";
import type { FaceBody } from "./regions.js";

export type GenerateInput = {
  setup: Pick<
    Setup,
    "id" | "bodies" | "stock" | "wcs" | "safeHeight" | "clearance"
  > &
    Partial<Pick<Setup, "fixtures">>;
  operation: { id: string; type: string; params: unknown };
  tool: Tool & { number: number };
  preset: Preset;
  bodies: (FaceBody & { bbox: Box })[];
};
