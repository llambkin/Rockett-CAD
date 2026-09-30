import { expect, it } from "vitest";
import {
  DOCUMENT_EDITS,
  VIEWER_WRITES,
  route,
  type Route,
} from "./routeContract.js";

it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)(
  "classifies %s route effects without registration",
  (method) => {
    for (const effect of [undefined, "document", "viewer"] as const) {
      const literal: Route = Object.freeze({
        method,
        path: "/projects/:id/m/contract/effects",
        ...(effect && { effect }),
      });
      expect(DOCUMENT_EDITS(literal)).toBe(effect === "document");
      expect(VIEWER_WRITES(literal)).toBe(effect === "viewer");
      const declared = route<never, unknown>()(
        method,
        literal.path,
        undefined,
        effect,
      );
      expect(DOCUMENT_EDITS(declared)).toBe(DOCUMENT_EDITS(literal));
      expect(VIEWER_WRITES(declared)).toBe(VIEWER_WRITES(literal));
    }
  },
);
