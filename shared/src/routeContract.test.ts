import { Type, type TSchema } from "typebox";
import { expect, expectTypeOf, it } from "vitest";
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

it("preserves supplied schema types without claiming absent validation", () => {
  const schema = Type.Object({ name: Type.String() });
  const declared = route<{ name: string }, unknown>()(
    "PATCH",
    "/projects/:id/name",
    schema,
    "document",
  );
  expectTypeOf(declared.body).toEqualTypeOf<typeof schema>();
  expect(declared.body).toBe(schema);
  const unparsed = route<{ name: string }, unknown>()(
    "PATCH",
    "/projects/:id/name",
    undefined,
    "document",
  );
  expectTypeOf(unparsed.body).toEqualTypeOf<TSchema | undefined>();
  expect(unparsed).not.toHaveProperty("body");
});
