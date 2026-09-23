import { describe, expect, it } from "vitest";
import os from "node:os";
import { ROUTES, pathFor } from "@rockett/shared";
import { createApiRouter } from "../src/api/routes.js";
import { ProjectStore } from "../src/store/projectStore.js";

function registered(): string[] {
  const router = createApiRouter(new ProjectStore(os.tmpdir()));
  return router.stack.flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    const methods = new Set(route.stack.map((l) => l.method.toUpperCase()));
    return [...methods].map((method) => `${method} ${route.path}`);
  });
}

const declared = Object.values(ROUTES).map(
  (route) => `${route.method} ${route.path}`,
);

describe("route contract", () => {
  it("registers every ROUTES entry with its method", () => {
    expect(registered()).toEqual(expect.arrayContaining(declared));
  });

  it("registers no route missing from ROUTES", () => {
    expect(declared).toEqual(expect.arrayContaining(registered()));
    expect(registered()).toHaveLength(declared.length);
  });

  it("encodes a body id containing a colon", () => {
    expect(
      pathFor(ROUTES.updateBody, { id: "p1", bodyId: "extrude:1/a b" }),
    ).toBe("/projects/p1/bodies/extrude%3A1%2Fa%20b");
  });
});
