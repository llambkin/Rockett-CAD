import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { promises as fs } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { ROUTES, pathFor } from "@rockett/shared";
import { createApiRouter } from "../src/api/routes.js";
import { FolderStore } from "../src/store/folderStore.js";
import { LocalStorage } from "../src/store/storage.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";

function registered(): string[] {
  const router = createApiRouter(
    new ProjectStore(new LocalStorage(os.tmpdir(), fs), validateDocument),
    new FolderStore(new LocalStorage(os.tmpdir(), fs)),
  );
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

const edge = { kind: "edge", bodyId: "b1", edgeName: "e1" };
const params = { id: "p1", fid: "f1", bodyId: "b1", assetId: "a1" };

const wrongTyped: Partial<
  Record<keyof typeof ROUTES, { body: object; detail: string }>
> = {
  createProject: { body: { name: 5 }, detail: "/name" },
  placeProject: { body: { folderId: 5 }, detail: "/folderId" },
  createFolder: { body: { name: 5 }, detail: "/name" },
  updateFolder: { body: { parentId: 5 }, detail: "/parentId" },
  duplicateProject: { body: { name: 5 }, detail: "/name" },
  renameProject: { body: { name: 5 }, detail: "/name" },
  setTimeline: { body: { position: "2" }, detail: "/position" },
  tangentEdges: {
    body: { edge: { ...edge, bodyId: 1 } },
    detail: "/edge/bodyId",
  },
  projectEdge: { body: { edge, entityId: 7 }, detail: "/entityId" },
  measure: {
    body: { refs: [{ ...edge, edgeName: 3 }] },
    detail: "/refs/0",
  },
  exportModel: {
    body: { format: "stl", bodyIds: [5] },
    detail: "/bodyIds/0",
  },
  updateBody: { body: { visible: "yes" }, detail: "/visible" },
  updateGroups: {
    body: { groups: [{ id: 5, name: "G", kind: "body", members: [] }] },
    detail: "/groups/0/id",
  },
  putView: {
    body: { version: 1, hidden: { bodies: [5], features: [] } },
    detail: "/hidden/bodies/0",
  },
};

let server: Server;
let base = "";
let dataDir = "";

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-contract-"));
  const app = express().use(
    "/api",
    createApiRouter(
      new ProjectStore(new LocalStorage(dataDir, fs), validateDocument),
      new FolderStore(new LocalStorage(dataDir, fs)),
    ),
  );
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

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

  it("gives a body schema to exactly the non-feature routes with a JSON body", () => {
    const withBody = Object.entries(ROUTES)
      .filter(([, route]) => "body" in route)
      .map(([name]) => name);
    expect(new Set(withBody)).toEqual(new Set(Object.keys(wrongTyped)));
  });

  it.each(Object.entries(wrongTyped))(
    "%s rejects a wrong-typed field with its path",
    async (name, { body, detail }) => {
      const route = ROUTES[name as keyof typeof ROUTES];
      const res = await fetch(base + pathFor(route, params), {
        method: route.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "validation", detail });
    },
  );
});
