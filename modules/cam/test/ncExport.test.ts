import { serverRegister } from "./helpers/serverRegister.js";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type {
  CadDocument,
  ModuleFiles,
  RouteModuleApi,
  ServerBody,
  ServerContext,
  User,
} from "@rockett/plugin-api";
import manifest from "../manifest.json";
import cam from "../server.js";
import { formatProgram } from "../src/post/format.js";
import { normalise } from "../src/post/normalise.js";
import { emittedProblems, expected } from "../src/server/emitted.js";
import { mountGenerate } from "../src/server/generate.js";
import { mountExport } from "../src/server/ncExport.js";
import { POSTS } from "../src/server/posts.js";
import {
  CAM_EXTENSION,
  generateRoute,
  ncRoute,
  type CamData,
  type NcExport,
} from "../src/shared/document.js";
import type { Move, Program } from "../src/shared/ir.js";
import { newMachine, type MachineProfile } from "../src/shared/machine.js";
import { fixture, golden, loadPost } from "./goldens.js";

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

const grbl = loadPost("grbl");
const contour = fixture("contour");
const tool = contour.tools[0]!;
const mill: MachineProfile = { ...newMachine(0), id: "m1" };

const preset = {
  id: "p1",
  name: "MDF contour",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off" as const,
};

const body: ServerBody = {
  id: "b1",
  name: "Body 1",
  bbox: { min: [0, 0, -10], max: [40, 30, 0] } as ServerBody["bbox"],
  brep: "",
  faceNames: [],
  fingerprint: "f".repeat(64),
};

const setup = (id: string, name: string) => ({
  id,
  name,
  bodies: ["b1"],
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
  },
  wcs: {
    origin: {
      kind: "stockCorner" as const,
      x: "min" as const,
      y: "min" as const,
      z: "max" as const,
    },
    axes: { x: "+x" as const, z: "+z" as const },
    offsetIndex: 1,
    machine: { kind: "unknown" as const },
  },
  safeHeight: 15,
  clearance: 2,
  operations: [
    {
      id: "op1",
      type: "rockett.cam.contour",
      name: "Contour 1",
      toolId: "t1",
      presetId: "p1",
      params: {},
    },
    {
      id: "op2",
      type: "rockett.cam.pocket",
      name: "Pocket 1",
      toolId: "t1",
      presetId: "p1",
      params: {},
      suppressed: true,
    },
  ],
});

const project = (...setups: CamData["setups"]) =>
  ({
    name: "Bracket",
    extensions: {
      [CAM_EXTENSION]: {
        version: 1,
        data: { setups, tools: [{ ...tool, presets: [preset] }] },
      },
    },
  }) as unknown as CadDocument;

const camData = (doc: CadDocument) =>
  doc.extensions[CAM_EXTENSION]!.data as CamData;

function memory(): ModuleFiles {
  const stored = new Map<string, Uint8Array>();
  return {
    read: async (name) => stored.get(name) ?? null,
    write: async (name, data) => {
      stored.set(
        name,
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    remove: async (name) => {
      stored.delete(name);
    },
    list: async () => [...stored.keys()],
  };
}

type Input = { setup: { id: string }; operation: { id: string } };
type Handler = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

type Made = (program: Program) => Program;
type Mount = { machine?: MachineProfile; made?: Made; maxBytes?: number };

const twoTools: Made = (program) => ({
  ...program,
  tools: [...program.tools, { ...program.tools[0]!, id: "t2", number: 2 }],
  sections: [
    ...program.sections,
    ...program.sections.map((each) => ({ ...each, toolId: "t2" })),
  ],
});

async function mounted({
  machine = mill,
  made = (program) => program,
  maxBytes,
}: Mount = {}) {
  const routes = new Map<string, Handler>();
  const files = memory();
  const api: RouteModuleApi = {
    projectRoute: (route, read) => routes.set(route.path, read as Handler),
    userRoute: () => {},
    projectMutation: (route, edit) => routes.set(route.path, edit as Handler),
  };
  const context: ServerContext = {
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount(api);
      return () => {};
    }),
    startKernelJob: async (_id, input) => {
      const { setup: s, operation } = input as Input;
      const program = structuredClone(contour);
      program.setupId = s.id;
      for (const section of program.sections)
        section.operationId = operation.id;
      return made(program);
    },
    userData: (name) => ({
      read: async () =>
        name === "machines"
          ? { version: 1, data: [machine], etag: "e1", readOnly: false }
          : null,
      write: async () => null!,
    }),
    files,
    kernelVersion: { occt: "7.9.1", commit: "abc1234" },
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => [body],
  };
  if (maxBytes === undefined) await cam.activate(context);
  else mountExport(api, context, mountGenerate(api, context), maxBytes);
  const ctx = { user: mark };
  return {
    files,
    generate: (doc: CadDocument, setupId = "s1") =>
      routes.get(generateRoute.path)!(
        doc,
        { params: { id: "p1" }, body: { setupId, operationId: "op1" } },
        ctx,
      ),
    nc: (
      doc: CadDocument,
      setupIds = "s1",
      chosen: Record<string, string> = {},
    ): Promise<NcExport> =>
      routes.get(ncRoute.path)!(
        doc,
        {
          params: {
            id: "p1",
            machineId: "m1",
            postId: "grbl",
            toolChange: "perFile",
            setupIds,
            ...chosen,
          },
        },
        ctx,
      ),
  };
}

const blocked = (status: string, reason?: string) => ({
  blocked: [
    {
      kind: "operation",
      setupId: "s1",
      operationId: "op1",
      name: "Contour 1",
      status,
      ...(reason === undefined ? {} : { reason }),
    },
  ],
});

const over = (setupId: string) => ({
  blocked: [
    {
      kind: "check",
      setupId,
      rule: "post",
      reason: expect.stringMatching(/^output is over \d+ bytes$/),
    },
  ],
});

const unzipped = (out: NcExport) => {
  if (!("zip" in out)) throw new Error(JSON.stringify(out));
  const files = unzipSync(Buffer.from(out.zip, "base64"));
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      headed(strFromU8(bytes)).body,
    ]),
  );
};

const powered = (move: Move): Move =>
  move.kind === "feed" || move.kind === "arc" ? { ...move, power: 50 } : move;

const headed = (text: string) => {
  const lines = text.split("\n");
  return { header: lines.slice(0, 4), body: lines.slice(4).join("\n") };
};

describe("GET /projects/:id/m/rockett/cam/nc", () => {
  it("answers a stale or never generated operation blocked, naming it, with no file", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"));
    expect(await route.nc(doc)).toEqual(blocked("never"));
    await route.generate(doc);
    camData(doc).setups[0]!.clearance = 3;
    expect(await route.nc(doc)).toEqual(blocked("stale"));
  });

  it("returns the GRBL golden under its header for a clean setup, skipping the suppressed operation", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    const out = await route.nc(doc);
    if (!("nc" in out)) throw new Error(JSON.stringify(out));
    expect(out.fileName).toBe("Setup 1.nc");
    const { header, body: text } = headed(out.nc);
    expect(text).toBe(golden(grbl, "contour", 1)[0]);
    expect(header.slice(0, 3)).toEqual([
      `(Rockett CAM ${manifest.version})`,
      "(kernel OCCT 7.9.1 abc1234)",
      "(post grbl)",
    ]);
    expect(header[3]).toMatch(/^\(input [0-9a-f]{64}\)$/);
    expect(await route.nc(doc)).toEqual(out);
  });

  it("zips one file per setup, each the golden", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"), setup("s2", "Setup 2"));
    await route.generate(doc, "s1");
    await route.generate(doc, "s2");
    const out = await route.nc(doc, "s1,s2");
    if (!("zip" in out)) throw new Error(JSON.stringify(out));
    expect(out.fileName).toBe("Bracket.zip");
    const files = unzipSync(Buffer.from(out.zip, "base64"));
    expect(Object.keys(files)).toEqual(["Setup 1.nc", "Setup 2.nc"]);
    for (const bytes of Object.values(files))
      expect(headed(strFromU8(bytes)).body).toBe(golden(grbl, "contour", 1)[0]);
  });

  it("blocks on a check error and names the operation", async () => {
    const route = await mounted({ machine: { ...mill, maxFeedZ: 100 } });
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    const out = await route.nc(doc);
    if (!("blocked" in out)) throw new Error(JSON.stringify(out));
    expect(out.blocked.length).toBeGreaterThan(0);
    for (const blocker of out.blocked)
      expect(blocker).toMatchObject({
        kind: "check",
        setupId: "s1",
        rule: "feed",
        reason: expect.stringMatching(/^Contour 1: /),
      });
  });

  it("blocks a program that passes a stored hold-down, naming the operation and the hold-down", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    camData(doc).setups[0]!.fixtures = [
      { name: "toe clamp 1", min: [15, 34, 0], max: [25, 54, 10] },
    ];
    expect(await route.nc(doc)).toEqual({
      blocked: [
        {
          kind: "operation",
          setupId: "s1",
          operationId: "op1",
          name: "Contour 1",
          status: "stale",
        },
      ],
    });
    await route.generate(doc);
    const blocker = {
      kind: "check",
      setupId: "s1",
      rule: "fixture",
      reason: "Contour 1: the tool comes within 2 mm of toe clamp 1",
    };
    expect(await route.nc(doc)).toEqual({ blocked: [blocker, blocker] });
  });

  it("posts a laser profile with its laserPowerMax", async () => {
    const laser: MachineProfile = {
      ...mill,
      kind: "laser",
      laserMode: true,
      laserPowerMax: 1000,
    };
    const route = await mounted({
      machine: laser,
      made: (program) => ({
        ...program,
        sections: program.sections.map((section) => {
          const beam = { ...section, moves: section.moves.map(powered) };
          delete beam.spindle;
          return beam;
        }),
      }),
    });
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    const out = await route.nc(doc);
    if (!("nc" in out)) throw new Error(JSON.stringify(out));
    const lines = headed(out.nc).body.split("\n");
    expect(lines[0]).toBe("(Laser mode: GRBL needs $32=1)");
    expect(lines).toContain("G1 Z-3 F300 S500");
    expect(lines.filter((line) => /\bM3\b/.test(line))).toEqual([]);
  });

  it("switches grblHAL acceleration profiles around finishing only when the machine has them", async () => {
    const grblhal = loadPost("grblhal");
    const exported = async (machine: MachineProfile) => {
      const route = await mounted({ machine });
      const doc = project(setup("s1", "Setup 1"));
      await route.generate(doc);
      const out = await route.nc(doc, "s1", {
        postId: "grblhal",
        toolChange: "m6",
      });
      if (!("nc" in out)) throw new Error(JSON.stringify(out));
      return headed(out.nc).body;
    };
    expect(await exported({ ...mill, accelerationProfiles: true })).toBe(
      golden(grblhal, "contour-accel", 1)[0],
    );
    expect(await exported(mill)).toBe(golden(grblhal, "contour", 1)[0]);
  });

  it("refuses an unknown machine, post, tool change or setup with a reason", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"));
    expect(await route.nc(doc, "s1", { machineId: "m2" })).toEqual({
      reason: "Setup 1: machine m2 is not in your library",
    });
    expect(await route.nc(doc, "s1", { postId: "fanuc" })).toEqual({
      reason: "post fanuc is not installed",
    });
    expect(await route.nc(doc, "s1", { toolChange: "manual" })).toEqual({
      reason: "tool change manual is not perFile or m6",
    });
    expect(await route.nc(doc, "s9")).toEqual({
      reason: "setup s9 is not in this project",
    });
  });

  it("zips one file per tool for a multi-tool GRBL setup", async () => {
    const route = await mounted({ made: twoTools });
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    const out = await route.nc(doc);
    expect(out).toMatchObject({ fileName: "Bracket.zip" });
    const [text] = golden(grbl, "contour", 1);
    expect(unzipped(out)).toEqual({
      "Setup 1-1.nc": text,
      "Setup 1-2.nc": text,
    });
  });

  it("keeps every file when a setup name collides with a per-tool name", async () => {
    const route = await mounted({
      made: (program) =>
        program.setupId === "s1" ? twoTools(program) : program,
    });
    const doc = project(setup("s1", "A"), setup("s2", "A-1"));
    await route.generate(doc, "s1");
    await route.generate(doc, "s2");
    const files = unzipped(await route.nc(doc, "s1,s2"));
    expect(Object.keys(files)).toEqual(["A-1.nc", "A-2.nc", "A-1-2.nc"]);
    for (const text of Object.values(files))
      expect(text).toBe(golden(grbl, "contour", 1)[0]);
  });

  it("blocks error and missingReference operations", async () => {
    const route = await mounted();
    const unknown = project(setup("s1", "Setup 1"));
    camData(unknown).setups[0]!.operations![0]!.type = "rockett.cam.nope";
    expect(await route.nc(unknown)).toEqual(
      blocked("error", "operation rockett.cam.nope is unknown"),
    );
    const missing = project({ ...setup("s1", "Setup 1"), bodies: ["b9"] });
    expect(await route.nc(missing)).toEqual(
      blocked("missingReference", "setup body b9 is not in the model"),
    );
  });

  it("blocks a fresh operation whose program is no longer cached", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    for (const name of await route.files.list()) await route.files.remove(name);
    expect(await route.nc(doc)).toEqual(
      blocked("fresh", "is not cached; generate it again"),
    );
  });

  it("gives its own reason for an all-suppressed setup and an empty one", async () => {
    const route = await mounted();
    const quiet = setup("s1", "Setup 1");
    quiet.operations[0]!.suppressed = true;
    expect(await route.nc(project(quiet))).toEqual({
      reason: "Nothing to export: every operation is suppressed",
    });
    expect(
      await route.nc(project({ ...setup("s1", "Setup 1"), operations: [] })),
    ).toEqual({
      reason: "Nothing to export: the chosen setups have no operations",
    });
  });

  it("refuses a repeated setup id or more ids than the project has setups", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"), setup("s2", "Setup 2"));
    expect(await route.nc(doc, "s1,s1")).toEqual({
      reason: "setup s1 is asked for twice",
    });
    expect(await route.nc(doc, "s1,s2,s1")).toEqual({
      reason: "3 setups were asked for; this project has 2",
    });
  });

  it("bounds the whole export by one byte budget across setups", async () => {
    const tight = async (maxBytes?: number) => {
      const route = await mounted(maxBytes === undefined ? {} : { maxBytes });
      const doc = project(setup("s1", "Setup 1"), setup("s2", "Setup 2"));
      await route.generate(doc, "s1");
      await route.generate(doc, "s2");
      return (setupIds?: string) => route.nc(doc, setupIds);
    };
    const one = await (await tight())();
    if (!("nc" in one)) throw new Error(JSON.stringify(one));
    const size = Buffer.byteLength(one.nc);
    expect(await (await tight(size))()).toEqual(one);
    expect(await (await tight(size - 1))()).toEqual(over("s1"));
    expect(await (await tight(size + 1))("s1,s2")).toEqual(over("s2"));
  });

  it("blocks a post that cannot change tools when asked to", async () => {
    const route = await mounted();
    const doc = project(setup("s1", "Setup 1"));
    await route.generate(doc);
    expect(await route.nc(doc, "s1", { toolChange: "m6" })).toEqual({
      blocked: [
        {
          kind: "check",
          setupId: "s1",
          rule: "post",
          reason: "post grbl does not support tool changes",
        },
      ],
    });
  });
});

describe("emittedProblems", () => {
  const units = "mm" as const;

  it("passes every shipped post's fixture output", () => {
    for (const post of POSTS.values())
      for (const name of ["facing", "contour", "pocket", "drill"]) {
        const normalised = normalise(fixture(name), post, { units });
        const files = formatProgram(normalised, post, {});
        files.forEach((text, i) =>
          expect(
            emittedProblems(text, post, expected(normalised, i, 1)),
            `${post.id} ${name}`,
          ).toEqual([]),
        );
      }
  });

  it("names rounding, modal, units, comment and tool change faults", () => {
    const check = (lines: string[], toolChanges: number[] = []) =>
      emittedProblems(`${lines.join("\n")}\n`, grbl, {
        units,
        offsetIndex: 1,
        toolChanges,
      });
    expect(
      check(
        [
          "G90 G94 G91.1 G17 G21",
          "G54",
          "G1 X1 F100",
          "M3 S18000",
          "G0 X1.23456 Y-0 Z5.0",
          "X2",
          "(bad ; comment)",
          "G55 G21",
        ],
        [1],
      ),
    ).toEqual([
      "line 3: feeds with the spindle off",
      "line 5: G0 X1.23456 Y-0 Z5.0 is not in the grbl dialect",
      "line 7: (bad ; comment) is not in the grbl dialect",
      "the file sets units G21 G21, not G21",
      "the file sets work offset G54 G55, not G54",
      "the file changes to tools none, not 1",
    ]);
    expect(check(["G90", "G54", "G0 X1 Y1 Z1", "X2 T1"])).toEqual([
      "line 3: moves before the units and work offset are set",
      "line 4: X2 T1 is not in the grbl dialect",
      "line 4: moves before the units and work offset are set",
      "the file sets units none, not G21",
    ]);
    expect(check(["G21", "G54", "X1", "M3 S1000", "G1 X2"])).toEqual([
      "line 3: moves with no motion mode in effect",
      "line 5: feeds with no feed rate in effect",
    ]);
  });

  it("reads tool changes from the post's tool change template", () => {
    const linuxcnc = loadPost("linuxcnc");
    const normalised = normalise(fixture("drill"), linuxcnc, {
      units,
      toolChange: true,
    });
    const [text] = formatProgram(normalised, linuxcnc, {});
    expect(
      emittedProblems(text!, linuxcnc, {
        units,
        offsetIndex: 1,
        toolChanges: [1, 2],
      }),
    ).toEqual([]);
    expect(
      emittedProblems(text!, linuxcnc, {
        units,
        offsetIndex: 1,
        toolChanges: [1],
      }),
    ).toEqual(["the file changes to tools 1 2, not 1"]);
  });

  it("checks the work offset against the setup's offsetIndex", () => {
    const normalised = normalise(fixture("contour"), grbl, { units });
    const [text] = formatProgram(normalised, grbl, {});
    expect(emittedProblems(text!, grbl, expected(normalised, 0, 2))).toEqual([
      "the file sets work offset G54, not G55",
    ]);
  });
});

it("ships one post for each post processor the manifest declares", () => {
  expect(new Set([...POSTS.keys()].map((id) => `rockett.cam.${id}`))).toEqual(
    new Set(manifest.contributes.postProcessors),
  );
});
