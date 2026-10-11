import type { ReactElement, ReactNode } from "react";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CadDocument,
  OpenProject,
  ProjectView,
  ViewportLayer,
} from "@rockett/plugin-api";
import {
  cellSize,
  gridOf,
  simulateHeightmap,
  simulateJob,
  type SimulationJob,
} from "../src/client/heightmap.js";
import { holdDownDraft } from "../src/client/holdDowns.js";
import { STOCK_LAYER, stockLayer } from "../src/client/stockLayer.js";
import {
  toolpathBarView,
  toolpathPreview,
  type ToolpathPreview,
} from "../src/client/toolpaths.js";
import {
  CAM_EXTENSION,
  programRoute,
  surfaceRoute,
  type CamData,
} from "../src/shared/document.js";
import type { Move, Program, Xyz } from "../src/shared/ir.js";
import type { Box } from "../src/shared/setup.js";
import type { Tool } from "../src/shared/tools.js";

const STOCK: Box = { min: [0, 0, -10], max: [20, 20, 0] };
const RADIUS = 2;

const body = {
  id: "t1",
  name: "T1",
  diameter: 2 * RADIUS,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 4,
  flutes: 2,
  centreCutting: true,
};

const TOOLS = {
  flat: { ...body, kind: "flat" },
  ball: { ...body, kind: "ball" },
  vbit: { ...body, kind: "vbit", tipAngle: 90 },
} satisfies Record<string, Tool>;

const LIFT = {
  flat: () => 0,
  ball: (d: number) => RADIUS - Math.sqrt(RADIUS ** 2 - d ** 2),
  vbit: (d: number) => d,
};

const program = (tool: Tool, moves: Move[]): Program => ({
  irVersion: 1,
  units: "mm",
  setupId: "s1",
  offsetIndex: 1,
  tools: [{ ...tool, number: 1 }],
  sections: [
    {
      operationId: "op1",
      toolId: tool.id,
      pass: "rough",
      coolant: "off",
      moves,
    },
  ],
});

const pass = (from: Xyz, to: Xyz): Move[] => [
  { kind: "rapid", to: [from[0], from[1], 5] },
  { kind: "feed", to: from, feed: 300, role: "plunge" },
  { kind: "feed", to, feed: 800, role: "cut" },
  { kind: "rapid", to: [to[0], to[1], 5] },
];

const centre = (i: number) => i + 0.5;

const toSegment = (x: number, y: number, a: Xyz, b: Xyz) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.min(
    Math.max(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0),
    1,
  );
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};

describe("simulateHeightmap", () => {
  it("lowers exactly the cells a 10 mm flat pass at depth 2 sweeps", () => {
    const a: Xyz = [5, 10, -2];
    const b: Xyz = [15, 10, -2];
    const map = simulateHeightmap(program(TOOLS.flat, pass(a, b)), STOCK, 1);
    const expected = Array.from({ length: 400 }, (_, n) =>
      toSegment(centre(n % 20), centre(Math.floor(n / 20)), a, b) <= RADIUS
        ? -2
        : 0,
    );
    expect(map).toMatchObject({
      min: [0, 0],
      cellMm: 1,
      columns: 20,
      rows: 20,
    });
    expect([...map.heights]).toEqual(expected);
    expect(expected.filter((z) => z === -2)).toHaveLength(52);
  });

  it.each(["flat", "ball", "vbit"] as const)(
    "a level %s pass cuts its profile across the groove",
    (kind) => {
      const map = simulateHeightmap(
        program(TOOLS[kind], pass([5, 10, -2], [15, 10, -2])),
        STOCK,
        1,
      );
      for (let j = 8; j < 12; j++)
        expect(map.heights[j * 20 + 10]).toBeCloseTo(
          -2 + LIFT[kind](Math.abs(centre(j) - 10)),
          5,
        );
    },
  );

  it.each(["flat", "ball", "vbit"] as const)(
    "a %s ramp matches a dense sample of the swept tool",
    (kind) => {
      const a: Xyz = [4, 6, -1];
      const b: Xyz = [16, 13, -4];
      const map = simulateHeightmap(program(TOOLS[kind], pass(a, b)), STOCK, 1);
      const lowest = (x: number, y: number) => {
        let z = 0;
        for (let k = 0; k <= 20_000; k++) {
          const t = k / 20_000;
          const d = Math.hypot(
            x - a[0] - t * (b[0] - a[0]),
            y - a[1] - t * (b[1] - a[1]),
          );
          if (d <= RADIUS)
            z = Math.min(z, a[2] + t * (b[2] - a[2]) + LIFT[kind](d));
        }
        return z;
      };
      for (let n = 0; n < 400; n++)
        expect(map.heights[n]).toBeCloseTo(
          lowest(centre(n % 20), centre(Math.floor(n / 20))),
          2,
        );
    },
  );

  it("stops at the stock bottom", () => {
    const map = simulateHeightmap(
      program(TOOLS.flat, pass([5, 10, -15], [15, 10, -15])),
      STOCK,
      1,
    );
    expect(Math.min(...map.heights)).toBe(-10);
  });

  it("refuses a bull tool and a cell size that is not positive", () => {
    const bull: Tool = { ...body, kind: "bull", cornerRadius: 1 };
    expect(() =>
      simulateHeightmap(
        program(bull, pass([5, 10, -2], [15, 10, -2])),
        STOCK,
        1,
      ),
    ).toThrow("bull tools are not simulated yet");
    expect(() => simulateHeightmap(program(TOOLS.flat, []), STOCK, 0)).toThrow(
      "cell size must be greater than 0",
    );
  });
});

const camData = (programs: Record<string, Program>): CamData => ({
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
      operations: Object.keys(programs).map((id) => ({
        id,
        name: `Op ${id}`,
        type: "rockett.cam.contour",
      })),
    },
  ],
  tools: [],
});

function camProject(programs: Record<string, Program>): ProjectView {
  const open: OpenProject = {
    projectId: "p1",
    document: {
      extensions: {
        [CAM_EXTENSION]: { version: 1, data: camData(programs) },
      },
    } as unknown as CadDocument,
    bodies: [
      { id: "b1", name: "Body 1", bbox: { min: [0, 0, 0], max: [20, 20, 10] } },
    ],
  };
  return {
    get: () => open,
    subscribe: () => () => {},
    selection: () => [],
    picks: () => [],
    select() {},
    pick: () => () => {},
    measure: () => Promise.reject(new Error("measure is not used here")),
    read: (async (
      route: { path: string },
      { operationId }: { operationId: string },
    ) => {
      if (route.path === surfaceRoute.path) {
        const grid = gridOf(STOCK, cellSize(STOCK));
        const tops = Array<number>(grid.columns * grid.rows).fill(-5);
        return { ...grid, tops };
      }
      expect(route.path).toBe(programRoute.path);
      return { program: programs[operationId]! };
    }) as ProjectView["read"],
    mutate: async () => {},
  };
}

class InlineWorker {
  listeners = new Set<(event: { data: unknown }) => void>();
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") this.listeners.add(listener);
  }
  postMessage(job: SimulationJob) {
    let data: unknown;
    try {
      data = simulateJob(job);
    } catch (error) {
      data = { error };
    }
    queueMicrotask(() => this.listeners.forEach((l) => l({ data })));
  }
  terminate() {}
}

function mounted(project: ProjectView, preview: ToolpathPreview) {
  const group = new THREE.Group();
  const freed: unknown[] = [];
  const release = (root: THREE.Object3D) =>
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) freed.push(o.geometry);
    });
  const layer: ViewportLayer = {
    group,
    requestRender: () => {},
    disposeObject: release,
    disposeGroup: release,
    clearGroup(g) {
      const children = [...g.children];
      g.clear();
      children.forEach(release);
    },
  };
  const unmount = stockLayer(project, preview, holdDownDraft()).mount(layer);
  const meshes = () => {
    const found: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
    group.traverse((o) => o instanceof THREE.Mesh && found.push(o));
    return found;
  };
  const lines = () => {
    let n = 0;
    group.traverse((o) => o instanceof THREE.LineSegments && n++);
    return n;
  };
  return { meshes, lines, freed, unmount };
}

const children = (node: ReactNode): ReactElement[] =>
  Array.isArray(node)
    ? node.flatMap(children)
    : node && typeof node === "object" && "props" in node
      ? [
          node as ReactElement,
          ...children((node.props as { children?: ReactNode }).children),
        ]
      : [];

const settled = (preview: ToolpathPreview, status: string) =>
  new Promise<void>((resolve) => {
    const off = preview.subscribe(() => {
      if (preview.get().simulation.status !== status) return;
      off();
      resolve();
    });
  });

const props = (e: ReactElement) =>
  e.props as {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    role?: string;
  };

function bar(preview: ToolpathPreview) {
  const all = children(toolpathBarView(preview.get(), preview));
  const simulate = all.find(
    (e) => e.type === "button" && props(e).children === "Simulate",
  );
  return {
    simulate: simulate && props(simulate),
    status: all
      .filter((e) => props(e).role === "status")
      .map((e) => props(e).children),
  };
}

describe(`Simulate on layer ${STOCK_LAYER}`, () => {
  beforeAll(() => {
    vi.stubGlobal("Worker", InlineWorker);
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) =>
        name === "--border" ? "#888888" : "#000000",
    }));
  });
  afterAll(() => vi.unstubAllGlobals());

  it("draws the simulated stock surface and a selection change removes it", async () => {
    const project = camProject({
      a: program(TOOLS.flat, pass([5, 10, -2], [15, 10, -2])),
      b: program(TOOLS.ball, pass([10, 3, -4], [10, 17, -4])),
    });
    const preview = toolpathPreview(project);
    const layer = mounted(project, preview);
    expect(bar(preview).simulate).toBeUndefined();
    await preview.select({ setupId: "s1", operationId: "a" });
    expect(layer.meshes()).toEqual([]);
    const press = bar(preview).simulate!;
    expect(press.disabled).toBe(false);
    const done = settled(preview, "done");
    press.onClick!();
    expect(bar(preview)).toMatchObject({
      simulate: { disabled: true },
      status: ["Simulating..."],
    });
    await done;
    const [surface] = layer.meshes();
    expect(layer.meshes()).toHaveLength(1);
    expect(layer.lines()).toBe(4);
    expect(surface!.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(surface!.material.userData.themeToken).toBe("border");
    const z = surface!.geometry.getAttribute("position");
    expect(z.count).toBe(40 * 40);
    const heights = Array.from({ length: z.count }, (_, i) => z.getZ(i));
    expect(Math.min(...heights)).toBe(-2);
    expect(Math.max(...heights)).toBe(0);
    expect(bar(preview).status).toEqual(["No gouges"]);
    await preview.select({ setupId: "s1", operationId: "b" });
    expect(layer.meshes()).toEqual([]);
    expect(layer.freed).toContain(surface!.geometry);
    expect(preview.get().simulation).toEqual({ status: "idle" });
    if (layer.unmount) layer.unmount();
  });

  it("shows a refusal in text and draws nothing", async () => {
    const bull: Tool = { ...body, kind: "bull", cornerRadius: 1 };
    const project = camProject({
      a: program(bull, pass([5, 10, -2], [15, 10, -2])),
    });
    const preview = toolpathPreview(project);
    const layer = mounted(project, preview);
    await preview.select({ setupId: "s1" });
    const failed = settled(preview, "failed");
    bar(preview).simulate!.onClick!();
    await failed;
    expect(bar(preview).status).toEqual(["bull tools are not simulated yet"]);
    expect(layer.meshes()).toEqual([]);
    if (layer.unmount) layer.unmount();
  });
});
