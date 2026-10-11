import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defineServerModule, PLUGIN_API_VERSION } from "@rockett/plugin-api";
import { parseManifest } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import {
  loadModules,
  type HostModule,
} from "../../../server/src/modules/host.js";
import { serverModules } from "../../index.server.js";
import client from "../client.js";
import manifest from "../manifest.json";
import server from "../server.js";

const modules = resolve(import.meta.dirname, "../..");
const provider = serverModules.find(
  (entry) => entry.manifest.id === "rockett.kicad",
)!;
const elec = { manifest, server, folder: new URL("../", import.meta.url) };
const fixture = (version: number) =>
  readFileSync(
    resolve(modules, `kicad/test/fixtures/outline-kicad${version}.kicad_pcb`),
  );
let close = async () => {};

afterEach(async () => {
  await close();
  close = async () => {};
});

async function project(loaded: HostModule[]) {
  const f = await moduleProjectFixture({ id: "fixture.empty", mount() {} });
  f.off();
  let stop = await loadModules(loaded, f.kernel, f.store, f.folders);
  f.remount();
  close = async () => {
    stop();
    await f.close();
  };
  const reload = async (next: HostModule[]) => {
    stop();
    stop = await loadModules(next, f.kernel, f.store, f.folders);
    f.remount();
  };
  const upload = async (source: Uint8Array) => {
    const response = await f.request(
      `/projects/${f.doc.id}/m/rockett/kicad/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
        },
        body: JSON.stringify({
          source: Buffer.from(source).toString("base64"),
        }),
      },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { linkId: string }).linkId;
  };
  const nets = (linkId: string, identity = f.editor) =>
    f.request(
      `/projects/${f.doc.id}/m/rockett/elec/boards/${linkId}/nets`,
      {},
      identity,
    );
  return { ...f, reload, upload, nets };
}

const refusal = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  return ((await response.json()) as { error: string }).error;
};

it("registers a compatible electrical module on both hosts", () => {
  expect(parseManifest(manifest, PLUGIN_API_VERSION).status).toBe("compatible");
  expect(serverModules).toContainEqual(elec);
  expect(client.activate).toBeTypeOf("function");
  expect(readFileSync(resolve(modules, "elec/LICENSE"), "utf8")).toContain(
    "No licence grant",
  );
  expect(readFileSync(resolve(modules, "index.client.ts"), "utf8")).toMatch(
    /manifest: elecManifest, client: elecClient, icons: \{\}/,
  );
  expect(
    readFileSync(resolve(modules, "../Dockerfile"), "utf8").match(
      /^COPY modules\/elec\/package.json modules\/elec\/package.json$/gm,
    ),
  ).toHaveLength(2);
});

it("reads equal KiCad 9 and 10 fixture nets through the rockett.kicad service", async () => {
  const f = await project([provider, elec]);
  const kicad9 = await f.upload(fixture(9));
  const kicad10 = await f.upload(fixture(10));
  const first = await f.nets(kicad9, f.viewer);
  expect(first.status).toBe(200);
  const nets = await first.json();
  expect(nets).toEqual({
    nets: [
      {
        name: "fixture-net",
        members: [
          {
            footprintUuid: "00000000-0000-4000-8000-000000000007",
            reference: "",
            pad: "1",
          },
        ],
      },
    ],
  });
  expect(await (await f.nets(kicad10)).json()).toEqual(nets);
  expect(await refusal(await f.nets(kicad9, f.outsider), 404)).toContain(
    "not found",
  );
  expect(await refusal(await f.nets("missing"), 422)).toBe(
    "KiCad board link is not in this project",
  );
});

it("reports Requires module rockett.kicad without a provider and refuses invalid nets", async () => {
  const f = await project([provider, elec]);
  const linkId = await f.upload(fixture(9));
  await f.reload([elec]);
  expect(await refusal(await f.nets(linkId), 422)).toBe(
    "Requires module rockett.kicad",
  );
  const invalid = defineServerModule({
    activate({ services }) {
      services.provide("rockett.kicad.boardNets", async () => ({
        nets: [{ name: "GND", members: [{ footprintUuid: "" }] }],
      }));
    },
  });
  await f.reload([{ manifest: provider.manifest, server: invalid }, elec]);
  expect(await refusal(await f.nets(linkId), 422)).toBe(
    "Module rockett.kicad returned invalid board nets",
  );
});
