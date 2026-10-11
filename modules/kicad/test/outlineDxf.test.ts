import { afterEach, expect, it } from "vitest";
import type { ClientContext, Command, FaceRef } from "@rockett/plugin-api";
import {
  detectProfiles,
  importDxf,
  pathFor,
  type Feature,
  type Route,
  type SketchEntity,
} from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import client from "../client.js";
import manifest from "../manifest.json";
import server from "../server.js";

const outline: SketchEntity[] = [
  { id: "a", kind: "point", x: 0, y: 0 },
  { id: "b", kind: "point", x: 50, y: 0 },
  { id: "c", kind: "point", x: 50, y: 30 },
  { id: "d", kind: "point", x: 0, y: 30 },
  { id: "m", kind: "point", x: 25, y: 30 },
  { id: "h1", kind: "point", x: 5, y: 5 },
  { id: "h2", kind: "point", x: 45, y: 5 },
  { id: "ab", kind: "line", p1: "a", p2: "b" },
  { id: "bc", kind: "line", p1: "b", p2: "c" },
  { id: "cd", kind: "arc", center: "m", start: "c", end: "d" },
  { id: "da", kind: "line", p1: "d", p2: "a" },
  { id: "hole1", kind: "circle", center: "h1", radius: 1.6 },
  { id: "hole2", kind: "circle", center: "h2", radius: 1.6 },
];

const meta = (id: string) => ({ id, name: id, suppressed: false });

const plate = (): Feature[] => [
  {
    ...meta("boardSk"),
    type: "sketch",
    plane: { kind: "origin", plane: "XY" },
    entities: outline,
    constraints: [],
  },
  {
    ...meta("board"),
    type: "extrude",
    profiles: [
      {
        sketchId: "boardSk",
        profileId: detectProfiles(outline).find((p) => p.holes.length === 2)!
          .id,
      },
    ],
    distance: 1.6,
    direction: "normal",
    operation: "newBody",
  },
];

type Curve = { kind: string; values: number[] };

function curves(entities: readonly SketchEntity[]): Curve[] {
  const at = new Map(
    entities.flatMap((e) =>
      e.kind === "point" ? [[e.id, [e.x, e.y]] as const] : [],
    ),
  );
  const xy = (id: string) => at.get(id)!;
  return entities
    .flatMap((e): Curve[] => {
      if (e.kind === "line")
        return [{ kind: e.kind, values: [...xy(e.p1), ...xy(e.p2)] }];
      if (e.kind === "arc")
        return [
          {
            kind: e.kind,
            values: [...xy(e.center), ...xy(e.start), ...xy(e.end)],
          },
        ];
      if (e.kind === "circle")
        return [{ kind: e.kind, values: [...xy(e.center), e.radius] }];
      return [];
    })
    .map(({ kind, values }) => ({
      kind,
      values: kind === "line" ? lineKey(values) : values,
    }))
    .toSorted((p, q) => key(p).localeCompare(key(q)));
}

function lineKey([x1, y1, x2, y2]: number[]) {
  const ends = [
    [x1!, y1!],
    [x2!, y2!],
  ].toSorted((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
  return ends.flat();
}

const key = ({ kind, values }: Curve) =>
  `${kind}:${values.map((v) => v.toFixed(3)).join(",")}`;

function expectLoop(dxf: string) {
  const layers = dxf
    .split("\n")
    .flatMap((code, i, lines) =>
      i % 2 === 0 && code.trim() === "8" ? [lines[i + 1]!] : [],
    );
  expect(new Set(layers)).toEqual(new Set(["Edge.Cuts"]));
  const back = importDxf(dxf);
  expect(back.skipped).toBe(0);
  const got = curves(back.entities);
  const want = curves(outline);
  expect(got.map(({ kind }) => kind)).toEqual(want.map(({ kind }) => kind));
  expect(got.filter(({ kind }) => kind === "circle")).toHaveLength(2);
  got.forEach(({ values }, i) =>
    values.forEach((v, j) =>
      expect(Math.abs(v - want[i]!.values[j]!)).toBeLessThanOrEqual(1e-6),
    ),
  );
}

let close = async () => {};
afterEach(async () => {
  await close();
  close = async () => {};
});

async function fixture() {
  const f = await moduleProjectFixture({ id: "fixture.empty", mount() {} });
  f.off();
  const stop = await loadModules(
    [{ manifest, server }],
    f.kernel,
    f.store,
    f.folders,
  );
  f.remount();
  close = async () => {
    stop();
    await f.close();
  };
  const doc = await f.store.load(f.doc.id);
  doc.features = plate();
  doc.timelinePosition = doc.features.length;
  await f.store.save(doc, f.owner.user.id);
  return f;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function clientOf(f: Fixture, selection: FaceRef[]) {
  const commands: Command[] = [];
  const files: { fileName: string; data: BlobPart; type: string }[] = [];
  const errors: string[] = [];
  const context = {
    register: {
      command: (c: Command) => (commands.push(c), () => {}),
      menuItem: () => () => {},
    },
    project: {
      selection: () => selection,
      get: () => ({
        projectId: f.doc.id,
        document: null,
        bodies: [{ id: "b:board", name: "Board" }],
      }),
      read: async (route: Route, params: Record<string, string>) => {
        const response = await f.request(
          pathFor(route, { ...params, id: f.doc.id }),
        );
        const body = await response.json();
        if (!response.ok) throw new Error((body as { error: string }).error);
        return body;
      },
    },
    ui: {
      download: (file: (typeof files)[number]) => files.push(file),
      showError: (message: string) => errors.push(message),
    },
  } as unknown as ClientContext;
  void client.activate(context);
  const command = commands.find(
    ({ id }) => id === "rockett.kicad.exportOutline",
  )!;
  return { command, files, errors };
}

it("writes the planar face loop and its hole circles on Edge.Cuts in mm from the command, parsing back within 1e-6", async () => {
  const f = await fixture();
  const top = {
    kind: "face",
    bodyId: "b:board",
    faceName: "f:board:cap:end",
  } as const;
  const { command, files, errors } = clientOf(f, [top]);
  expect(command.label).toBeTruthy();
  expect(command.enabled?.(undefined)).toBe(true);

  await command.run!(undefined);

  expect(errors).toEqual([]);
  expect(files.map(({ fileName, type }) => [fileName, type])).toEqual([
    ["Board.dxf", "image/vnd.dxf"],
  ]);
  expectLoop(files[0]!.data as string);
});

it("writes a sketch loop with its hole circles on Edge.Cuts through the outline route", async () => {
  const f = await fixture();
  const response = await f.request(
    `/projects/${f.doc.id}/m/rockett/kicad/outline/sketch/boardSk`,
  );
  expect(response.status).toBe(200);
  expectLoop((await response.json()) as string);
});

it("refuses a curved face and needs exactly one selected face", async () => {
  const f = await fixture();
  const side = {
    kind: "face",
    bodyId: "b:board",
    faceName: "f:board:s:cd",
  } as const;
  const curved = clientOf(f, [side]);
  await curved.command.run!(undefined);
  expect(curved.files).toEqual([]);
  expect(curved.errors).toEqual(["face f:board:s:cd is not planar"]);

  const top = {
    kind: "face",
    bodyId: "b:board",
    faceName: "f:board:cap:end",
  } as const;
  const none = clientOf(f, []);
  const two = clientOf(f, [top, side]);
  expect(none.command.enabled?.(undefined)).toBe("Select one planar face");
  expect(two.command.enabled?.(undefined)).toBe("Select one planar face");
});
