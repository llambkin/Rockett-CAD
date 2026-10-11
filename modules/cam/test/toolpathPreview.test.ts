import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CadDocument,
  OpenProject,
  ProjectView,
  ViewportLayer,
} from "@rockett/plugin-api";
import { programToSegments } from "../src/client/segments.js";
import {
  TOOLPATH_LAYER,
  toolpathLayer,
  toolpathPreview,
} from "../src/client/toolpaths.js";
import {
  CAM_EXTENSION,
  programRoute,
  type CamData,
} from "../src/shared/document.js";
import {
  arcSweep,
  endOf,
  inPlane,
  type Arc,
  type Move,
  type Program,
  type Xyz,
} from "../src/shared/ir.js";

const fixture = (name: string): Program =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/ir/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

const contour = fixture("contour");
const pocket = fixture("pocket");

const withMoves = (moves: Move[]): Program => ({
  ...contour,
  sections: [{ ...contour.sections[0]!, moves }],
});

const arc = (
  to: Xyz,
  centre: Xyz,
  dir: Arc["dir"],
  plane: Arc["plane"] = "xy",
): Arc => ({ kind: "arc", to, centre, dir, plane, feed: 800, role: "cut" });

const synthetic = withMoves([
  { kind: "rapid", to: [500, 0, 0] },
  arc([0, 500, 0], [0, 0, 0], "ccw"),
  arc([500, 0, 0], [0, 0, 0], "ccw"),
  { kind: "rapid", to: [10, 0, 5] },
  arc([10, 0, 5], [0, 0, 5], "cw"),
  arc([0, 10, -5], [0, 0, 0], "ccw"),
  { kind: "rapid", to: [0, 0, 20] },
  arc([0, 0, -20], [0, 0, 0], "cw", "zx"),
  { kind: "rapid", to: [0, 3, 0] },
  arc([0, 0, 3], [0, 0, 0], "ccw", "yz"),
]);

const TAU = 2 * Math.PI;
const vertex = (positions: Float32Array, i: number): Xyz => [
  positions[3 * i]!,
  positions[3 * i + 1]!,
  positions[3 * i + 2]!,
];

function arcSegments(program: Program) {
  const { positions, moveEnds } = programToSegments(program);
  const found: { from: Xyz; arc: Arc; points: Xyz[] }[] = [];
  let at: Xyz | undefined;
  let k = 0;
  for (const { moves } of program.sections)
    for (const move of moves) {
      if (move.kind === "comment") continue;
      if (move.kind === "arc" && at) {
        const points: Xyz[] = [];
        for (let i = moveEnds[k - 1] ?? 0; i < moveEnds[k]!; i++)
          points.push(vertex(positions, i));
        found.push({ from: at, arc: move, points });
      }
      at = endOf(move, at);
      k++;
    }
  return found;
}

describe("programToSegments", () => {
  it("every arc segment lies within 0.01 mm of its arc", () => {
    const arcs = [contour, pocket, synthetic].flatMap(arcSegments);
    expect(arcs.length).toBeGreaterThan(10);
    for (const { from, arc: move, points } of arcs) {
      const [cu, cv] = inPlane(move.centre, move.plane);
      const [su, sv] = inPlane(from, move.plane);
      const radius = Math.hypot(su - cu, sv - cv);
      const sign = move.dir === "ccw" ? 1 : -1;
      expect(points[0]).toEqual(from.map(Math.fround));
      expect(points.at(-1)).toEqual(move.to.map(Math.fround));
      let swept = 0;
      for (let i = 0; i < points.length; i += 2) {
        const [au, av] = inPlane(points[i]!, move.plane);
        const [bu, bv] = inPlane(points[i + 1]!, move.plane);
        if (i > 0) expect(points[i]).toEqual(points[i - 1]);
        for (const off of [
          Math.hypot(au - cu, av - cv),
          Math.hypot(bu - cu, bv - cv),
        ])
          expect(Math.abs(off - radius)).toBeLessThan(1e-3);
        const turn =
          sign * (Math.atan2(bv - cv, bu - cu) - Math.atan2(av - cv, au - cu));
        const step = ((turn % TAU) + TAU) % TAU;
        expect(step).toBeLessThan(Math.PI / 2);
        swept += step;
        const mid = Math.hypot((au + bu) / 2 - cu, (av + bv) / 2 - cv);
        expect(radius - mid).toBeLessThanOrEqual(0.01 + 1e-4);
      }
      expect(points.length).toBeGreaterThan(2);
      expect(swept).toBeCloseTo(arcSweep(from, move), 3);
    }
  });

  it("gives each vertex its role and each section its vertex range", () => {
    const program: Program = {
      ...contour,
      sections: [
        {
          ...contour.sections[0]!,
          operationId: "a",
          moves: [
            { kind: "comment", text: "start" },
            { kind: "rapid", to: [0, 0, 5] },
            { kind: "feed", to: [0, 0, -1], feed: 300, role: "plunge" },
            { kind: "feed", to: [10, 0, -1], feed: 800, role: "cut" },
          ],
        },
        {
          ...contour.sections[0]!,
          operationId: "b",
          moves: [
            { kind: "feed", to: [10, 5, -1], feed: 800, role: "link" },
            { kind: "rapid", to: [10, 5, 5] },
          ],
        },
      ],
    };
    const { positions, roles, moveEnds, sections } = programToSegments(program);
    expect([...roles]).toEqual([2, 2, 1, 1, 3, 3, 0, 0]);
    expect([...moveEnds]).toEqual([0, 2, 4, 6, 8]);
    expect(sections).toEqual([
      { operationId: "a", start: 0, count: 4 },
      { operationId: "b", start: 4, count: 4 },
    ]);
    expect(Array.from(positions.slice(0, 6))).toEqual([0, 0, 5, 0, 0, -1]);
    expect(Array.from(positions.slice(-6))).toEqual([10, 5, -1, 10, 5, 5]);
  });

  it("refuses a drill cycle rather than drawing it wrong", () => {
    expect(() => programToSegments(fixture("drill"))).toThrow(
      "drill cycles are not drawn yet",
    );
  });
});

const operation = (id: string, generated: boolean) => ({
  id,
  name: `Op ${id}`,
  type: "rockett.cam.contour",
  ...(generated && {
    lastGenerated: {
      fingerprint: id.repeat(64),
      programSha256: "0".repeat(64),
      at: "2026-10-04T00:00:00.000Z",
    },
  }),
});

const data: CamData = {
  setups: [
    {
      id: "s1",
      name: "Setup 1",
      bodies: ["b1"],
      stock: {
        kind: "boxAround",
        margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
      },
      wcs: {
        origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
        axes: { x: "+x", z: "+z" },
        offsetIndex: 1,
        machine: { kind: "unknown" },
      },
      operations: [
        operation("a", true),
        operation("b", true),
        operation("c", false),
      ],
    },
  ],
  tools: [],
};

const open: OpenProject = {
  projectId: "p1",
  document: {
    extensions: { [CAM_EXTENSION]: { version: 1, data } },
  } as unknown as CadDocument,
  bodies: [
    { id: "b1", name: "Body 1", bbox: { min: [0, 0, 0], max: [40, 30, 6] } },
  ],
};

const programs: Record<string, Program> = { a: contour, b: pocket };

function fakeProject() {
  const listeners = new Set<() => void>();
  const reads: string[] = [];
  const project: ProjectView = {
    get: () => open,
    selection: () => [],
    picks: () => [],
    select() {},
    pick: () => () => {},
    measure: () => Promise.reject(new Error("measure is not used here")),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read: (async (route: { path: string }, params: { operationId: string }) => {
      expect(route.path).toBe(programRoute.path);
      reads.push(params.operationId);
      const program = programs[params.operationId];
      return program
        ? { program }
        : { reason: `Op ${params.operationId} has not been generated` };
    }) as ProjectView["read"],
    mutate: async () => {},
  };
  return { project, listeners, reads };
}

function viewport() {
  const group = new THREE.Group();
  const requestRender = vi.fn();
  const freed: unknown[] = [];
  const release = (root: THREE.Object3D) =>
    root.traverse((o) => {
      const { geometry, material } = o as Partial<THREE.Mesh>;
      if (geometry) freed.push(geometry);
      for (const m of Array.isArray(material) ? material : [material])
        if (m) freed.push(m);
    });
  const layer: ViewportLayer = {
    group,
    requestRender,
    disposeObject: release,
    disposeGroup: release,
    clearGroup(g) {
      const children = [...g.children];
      g.clear();
      children.forEach(release);
    },
  };
  return { group, requestRender, freed, layer };
}

const lines = (group: THREE.Group) =>
  group.children as THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.Material[]
  >[];

describe(`layer ${TOOLPATH_LAYER}`, () => {
  beforeAll(() => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) =>
        ({
          "--accent": "#00aaff",
          "--warn": "#ffaa00",
          "--ok": "#00ff00",
          "--err": "#ff0000",
        })[name] ?? "",
    }));
  });
  afterAll(() => vi.unstubAllGlobals());

  it("draws nothing and holds no buffers with nothing selected", () => {
    const { project, reads } = fakeProject();
    const preview = toolpathPreview(project);
    const { group, layer } = viewport();
    const unmount = toolpathLayer(preview).mount(layer);
    expect(group.children).toEqual([]);
    expect(reads).toEqual([]);
    expect(preview.get()).toMatchObject({ moves: 0, shown: 0 });
    if (unmount) unmount();
  });

  it("draws the selected operation in role colours and scrubs drawRange", async () => {
    const { project } = fakeProject();
    const preview = toolpathPreview(project);
    const { group, layer, requestRender } = viewport();
    const unmount = toolpathLayer(preview).mount(layer);
    await preview.select({ setupId: "s1", operationId: "a" });
    const segments = programToSegments(contour);
    const [drawn] = lines(group);
    expect(lines(group)).toHaveLength(1);
    expect(drawn!.geometry.getAttribute("position").count).toBe(
      segments.roles.length,
    );
    const tokens = drawn!.material.map((m) => m.userData.themeToken);
    expect(tokens).toEqual(["err", "accent", "warn", "ok"]);
    expect(drawn!.material[0]).toBeInstanceOf(THREE.LineDashedMaterial);
    for (const { start, count, materialIndex } of drawn!.geometry.groups)
      for (let i = start; i < start + count; i++)
        expect(segments.roles[i]).toBe(materialIndex);
    const { moves, name } = preview.get();
    expect(name).toBe("Op a");
    expect(moves).toBe(segments.moveEnds.length);
    expect(drawn!.geometry.drawRange.count).toBe(segments.roles.length);
    requestRender.mockClear();
    preview.scrub(3);
    expect(preview.get().shown).toBe(3);
    expect(drawn!.geometry.drawRange.count).toBe(segments.moveEnds[2]);
    expect(requestRender).toHaveBeenCalled();
    if (unmount) unmount();
  });

  it("draws every generated operation of a selected setup across one scrub", async () => {
    const { project, reads } = fakeProject();
    const preview = toolpathPreview(project);
    const { group, layer } = viewport();
    const unmount = toolpathLayer(preview).mount(layer);
    await preview.select({ setupId: "s1" });
    expect(reads).toEqual(["a", "b", "c"]);
    const [first, second] = lines(group);
    expect(lines(group)).toHaveLength(2);
    const a = programToSegments(contour).moveEnds;
    const b = programToSegments(pocket).moveEnds;
    expect(preview.get()).toMatchObject({
      name: "Setup 1",
      moves: a.length + b.length,
    });
    preview.scrub(a.length + 2);
    expect(first!.geometry.drawRange.count).toBe(a.at(-1));
    expect(second!.geometry.drawRange.count).toBe(b[1]);
    preview.scrub(1);
    expect(first!.geometry.drawRange.count).toBe(a[0]);
    expect(second!.geometry.drawRange.count).toBe(0);
    if (unmount) unmount();
  });

  it("frees the geometry when the selection clears and stops on teardown", async () => {
    const { project, listeners } = fakeProject();
    const preview = toolpathPreview(project);
    const { group, layer, freed, requestRender } = viewport();
    const unmount = toolpathLayer(preview).mount(layer);
    await preview.select({ setupId: "s1", operationId: "a" });
    const [drawn] = lines(group);
    expect(listeners.size).toBe(1);
    await preview.select(null);
    expect(group.children).toEqual([]);
    expect(freed).toContain(drawn!.geometry);
    for (const material of drawn!.material) expect(freed).toContain(material);
    if (unmount) unmount();
    expect(listeners.size).toBe(0);
    requestRender.mockClear();
    await preview.select({ setupId: "s1", operationId: "a" });
    expect(group.children).toEqual([]);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("frees the old geometry when the selection moves to another operation", async () => {
    const { project } = fakeProject();
    const preview = toolpathPreview(project);
    const { group, layer, freed } = viewport();
    const unmount = toolpathLayer(preview).mount(layer);
    await preview.select({ setupId: "s1", operationId: "a" });
    const [first] = lines(group);
    await preview.select({ setupId: "s1", operationId: "b" });
    const [second] = lines(group);
    expect(lines(group)).toEqual([second]);
    expect(freed).toContain(first!.geometry);
    for (const material of first!.material) expect(freed).toContain(material);
    expect(freed).not.toContain(second!.geometry);
    if (unmount) unmount();
  });

  it("keeps the reason when the selected program is not cached", async () => {
    const { project } = fakeProject();
    const preview = toolpathPreview(project);
    const { group, layer } = viewport();
    const unmount = toolpathLayer(preview).mount(layer);
    await preview.select({ setupId: "s1", operationId: "c" });
    expect(group.children).toEqual([]);
    expect(preview.get().reason).toBe("Op c has not been generated");
    if (unmount) unmount();
  });
});
