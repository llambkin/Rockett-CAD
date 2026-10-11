import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parse, type User } from "@rockett/shared";
import type {
  ClientContext,
  Route,
  RouteModuleApi,
  ServerContext,
  UserData,
} from "@rockett/plugin-api";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { mountLibrary } from "../src/server/library.js";
import { machineFields } from "../src/client/machineForm.js";
import { CAM_VERSION, migrateCam } from "../src/shared/document.js";
import {
  FIRMWARE,
  machineSchema,
  newMachine,
  type MachineProfile,
} from "../src/shared/machine.js";

type Props = { label?: string; value: unknown; onChange(v: unknown): void };

const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

const field = (name: string) => Object.assign(() => null, { field: name });

const ui = {
  LengthField: field("length"),
  NumField: field("number"),
  SelectField: field("select"),
  CheckField: field("check"),
} as unknown as ClientContext["ui"];

const machine: MachineProfile = { ...newMachine(0), id: "m1" };

function form(value: MachineProfile) {
  const edit = vi.fn<(next: MachineProfile) => void>();
  const elements = machineFields(ui, value, edit) as ReactElement<Props>[];
  const at = (label: string) => elements.find((e) => e.props.label === label)!;
  return { edit, elements, at };
}

describe("machine profile form", () => {
  it("choosing grblHAL sets the grblHAL post as default", () => {
    const { edit, at } = form(machine);
    expect(machine.post).toBe("grbl");
    at("Firmware").props.onChange("grblhal");
    expect(edit).toHaveBeenCalledWith({
      ...machine,
      firmware: "grblhal",
      post: "grblhal",
    });
  });

  it("builds every field from the schema titles and bounds", () => {
    const { elements, at } = form(machine);
    expect(
      elements.map((e) => [
        (e.type as unknown as { field: string }).field,
        e.props.label,
      ]),
    ).toEqual([
      ["select", "Firmware"],
      ["length", "X min"],
      ["length", "X max"],
      ["length", "Y min"],
      ["length", "Y max"],
      ["length", "Z min"],
      ["length", "Z max"],
      ["number", "Max feed X (mm/min)"],
      ["number", "Max feed Y (mm/min)"],
      ["number", "Max feed Z (mm/min)"],
      ["number", "Min spindle speed (rpm)"],
      ["number", "Max spindle speed (rpm)"],
      ["number", "Measured min spindle speed (rpm)"],
      ["number", "Measured max spindle speed (rpm)"],
      ["number", "Rated power (W)"],
      ["number", "Rated speed (rpm)"],
      ["number", "Spin-up time (s)"],
      ["number", "Acceleration X (mm/s^2)"],
      ["number", "Acceleration Y (mm/s^2)"],
      ["number", "Acceleration Z (mm/s^2)"],
      ["number", "Junction deviation (mm)"],
      ["check", "Laser mode"],
      ["check", "Acceleration profiles (grblHAL)"],
      ["select", "Tool change"],
      ["select", "Output units"],
    ]);
    expect(at("Firmware").props).toMatchObject({
      options: [
        ["grbl", "GRBL 1.1"],
        ["grblhal", "grblHAL"],
        ["linuxcnc", "LinuxCNC"],
      ],
    });
    expect(at("Max feed X (mm/min)").props).toMatchObject({ above: 0 });
    expect(at("Max spindle speed (rpm)").props).toMatchObject({
      int: true,
      min: 1,
    });
  });

  it.each([
    ["grbl", "linuxcnc", "perFile", "m6"],
    ["linuxcnc", "grbl", "m6", "perFile"],
    ["linuxcnc", "grblhal", "m6", "m6"],
    ["grbl", "grblhal", "perFile", "perFile"],
  ] as const)(
    "%s to %s sets the tool change from %s to %s",
    (from, to, before, after) => {
      const { edit, at } = form({
        ...machine,
        firmware: from,
        post: from,
        toolChange: before,
      });
      at("Firmware").props.onChange(to);
      expect(edit.mock.calls[0]![0]).toMatchObject({
        firmware: to,
        post: to,
        toolChange: after,
      });
    },
  );

  it("names a shipped post for every firmware", () => {
    for (const { post: id } of Object.values(FIRMWARE)) {
      const post = readFileSync(
        new URL(`../posts/${id}.json`, import.meta.url),
        "utf8",
      );
      expect(JSON.parse(post).id).toBe(id);
    }
  });
});

describe("machine library", () => {
  const routes = new Map<string, (body: unknown) => Promise<unknown>>();
  let dataDir = "";
  let userData: (name: string, version: number) => UserData;

  const call = async (method: string, at: string, body?: unknown) =>
    routes.get(`${method} /m/rockett/cam/${at}`)!(body);

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-machine-"));
    const [{ moduleUserData }, { LocalStorage }] = await Promise.all([
      core("store/moduleData.ts"),
      core("store/storage.ts"),
    ]);
    userData = moduleUserData(new LocalStorage(dataDir, fs), "rockett.cam");
    const api = {
      projectMutation: () => {},
      userRoute: (route: Route, handle: any) =>
        routes.set(`${route.method} ${route.path}`, (value) =>
          handle(
            {
              params: {},
              body: route.body
                ? parse(route.body, structuredClone(value))
                : value,
            },
            { user: mark },
          ),
        ),
    } as unknown as RouteModuleApi;
    mountLibrary(api, userData as ServerContext["userData"]);
  });

  afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

  it("reads a store saved before machines unchanged", async () => {
    const tools = userData("tools", 1);
    const before = await tools.write(mark, [{ id: "t1", name: "6 mm" }], null);
    expect(await call("GET", "machines")).toBeNull();
    const saved = await call("PUT", "machines", {
      data: [machine],
      etag: null,
    });
    expect(saved).toMatchObject({ version: 1, data: [machine] });
    expect(await call("GET", "machines")).toEqual(saved);
    expect(await call("GET", "tools")).toEqual(before);
  });

  it("stores a machine's rigidity and refuses an unknown one by schema", async () => {
    const light = { ...machine, id: "m9", rigidity: "light" };
    const current = (await call("GET", "machines")) as { etag: string } | null;
    const saved = await call("PUT", "machines", {
      data: [light],
      etag: current?.etag ?? null,
    });
    expect(saved).toMatchObject({ data: [light] });
    await expect(
      call("PUT", "machines", {
        data: [{ ...machine, rigidity: "wobbly" }],
        etag: null,
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("a setup copy with a rigidity still reads under the schema from before it", () => {
    const light = { ...machine, rigidity: "light" as const };
    const before = Type.Omit(machineSchema, ["rigidity"]);
    expect(Value.Check(before, light)).toBe(true);
    const data = {
      setups: [{ id: "s1", machine: { ...light, libraryRef: { id: "m1" } } }],
      tools: [],
    };
    expect(migrateCam({ version: CAM_VERSION, data })).toEqual({
      status: "ready",
      data,
    });
  });

  it("refuses an axis whose max is not above its min", async () => {
    await expect(
      call("PUT", "machines", {
        data: [{ ...machine, id: "m2", zMax: -80 }],
        etag: null,
      }),
    ).rejects.toThrow("machine m2: Z max must be greater than Z min");
  });

  it("refuses an unknown firmware by schema", async () => {
    await expect(
      call("PUT", "machines", {
        data: [{ ...machine, firmware: "mach3" }],
        etag: null,
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("refuses GRBL 1.1 with M6", async () => {
    await expect(
      call("PUT", "machines", {
        data: [{ ...machine, id: "m3", toolChange: "m6" }],
        etag: null,
      }),
    ).rejects.toThrow("machine m3: GRBL 1.1 has no M6; use one file per tool");
  });

  it("refuses a max spindle speed below the min", async () => {
    await expect(
      call("PUT", "machines", {
        data: [{ ...machine, id: "m4", rpmMin: 9000, rpmMax: 8000 }],
        etag: null,
      }),
    ).rejects.toThrow("machine m4: max spindle speed must be at least the min");
  });

  it.each([
    ["a feed of 0", { maxFeedZ: 0 }],
    ["a fractional spindle speed", { rpmMax: 12000.5 }],
  ])("refuses %s by schema", async (_name, change) => {
    await expect(
      call("PUT", "machines", {
        data: [{ ...machine, ...change }],
        etag: null,
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
