import type { BodyRef, PlaneRef } from "./model.js";

export const THIN_LOCATIONS = ["inside", "outside", "centre"] as const;

export type ExtrudeExtent =
  { kind: "all" } | { kind: "toObject"; object: PlaneRef | BodyRef };

export interface ExtrudeThin {
  location: (typeof THIN_LOCATIONS)[number];
  thickness: number;
}
