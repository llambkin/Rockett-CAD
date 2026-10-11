import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CadDocument,
  OpenProject,
  ProjectView,
  ViewportLayer,
} from "@rockett/plugin-api";
import {
  fixturesOf,
  holdDownDraft,
  type HoldDown,
} from "../src/client/holdDowns.js";
import { stockLayer } from "../src/client/stockLayer.js";
import type { ToolpathPreview } from "../src/client/toolpaths.js";
import { planOperations, type PlanTool } from "../src/plan/plan.js";
import { checkProgram } from "../src/post/check.js";
import { CAM_EXTENSION } from "../src/shared/document.js";
import type { Program, Section } from "../src/shared/ir.js";
import { newMachine } from "../src/shared/machine.js";
import type { FaceRef } from "../src/shared/params.js";
import type { Fixture, Setup } from "../src/shared/setup.js";
import type { Tool } from "../src/shared/tools.js";
import { loadPost } from "./goldens.js";

const section = JSON.parse(
  readFileSync(new URL("./golden/ir/contour.json", import.meta.url), "utf8"),
) as Section;

const flat: Tool & { number: number } = {
  id: "t1",
  number: 1,
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const contour: Program = {
  irVersion: 1,
  units: "mm",
  setupId: "s1",
  offsetIndex: 1,
  tools: [flat],
  sections: [section],
};

const machine = newMachine(0);

const clamp: HoldDown = {
  kind: "toeClamp",
  x: 15,
  y: 28,
  width: 10,
  depth: 20,
  height: 10,
};

const setup = (fixtures: Fixture[]): Setup => ({
  id: contour.setupId,
  name: "Setup 1",
  bodies: ["b1"],
  stock: { kind: "box", size: [60, 50, 10] },
  wcs: {
    origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
    axes: { x: "+x", z: "+z" },
    offsetIndex: 1,
    machine: { kind: "known", origin: [100, 100, -30] },
  },
  safeHeight: 15,
  clearance: 3,
  tolerance: 0.01,
  fixtures,
});

const check = (holdDowns: HoldDown[]) =>
  checkProgram({
    program: contour,
    setup: setup(fixturesOf(holdDowns)),
    stock: { min: [-10, -10, -10], max: [50, 40, 0] },
    operations: [{ id: "op1", type: "rockett.cam.contour" }],
    machine,
    post: loadPost("grbl"),
    units: "mm",
  });

const face = (name: string, z: number): FaceRef => ({
  kind: "face",
  bodyId: "b1",
  faceName: name,
  sig: { type: "plane", point: [0, 0, z], direction: [0, 0, 1] },
});

const flat6: PlanTool = {
  id: "t1",
  name: "T1 6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
  presets: [
    {
      id: "p1",
      name: "MDF",
      rpm: 18000,
      cutFeed: 1000,
      plungeFeed: 300,
      rampFeed: 500,
      stepdown: 3,
      stepoverFraction: 0.5,
      coolant: "off",
    },
  ],
};

describe("hold-downs", () => {
  it("a toe clamp over a contour path makes checkProgram name the clamp and the move", () => {
    expect(fixturesOf([clamp])).toEqual([
      { name: "toe clamp 1", min: [15, 28, 0], max: [25, 48, 10] },
    ]);
    const reason = "the tool comes within 3 mm of toe clamp 1";
    expect(check([clamp]).problems).toEqual([
      { rule: "fixture", section: 0, move: 5, reason },
      { rule: "fixture", section: 0, move: 15, reason },
    ]);
  });

  it("adds no keep-out for tape or vacuum and numbers the rest by kind", () => {
    const at = { x: 0, y: 0, width: 4, depth: 4, height: -2 };
    expect(
      check([
        { ...clamp, kind: "tape" },
        { ...clamp, kind: "vacuum" },
      ]),
    ).toMatchObject({ problems: [], qualified: true });
    expect(
      fixturesOf([
        { ...at, kind: "screw" },
        { ...clamp, kind: "vacuum" },
        { ...at, kind: "toeClamp" },
        { ...at, kind: "box" },
        { ...at, kind: "toeClamp" },
      ]).map(({ name, min, max }) => [name, min[2], max[2]]),
    ).toEqual([
      ["screw 1", -2, -2],
      ["toe clamp 1", -2, -2],
      ["custom box 1", -2, -2],
      ["toe clamp 2", -2, -2],
    ]);
  });

  it("leaves a blocked feature out of the plan and names the hold-down", () => {
    const pocket = (id: string, x: number) => ({
      id,
      name: `Pocket ${id}`,
      floor: face(`f:${id}`, -5),
      z: -5,
      width: 10,
      cornerRadius: 3,
      footprint: {
        min: [x, 35] as [number, number],
        max: [x + 10, 45] as [number, number],
      },
    });
    const plan = planOperations(
      { material: "mdf", clearance: 3, fixtures: fixturesOf([clamp]) },
      {
        stockTop: 2,
        stockOutline: { min: [-10, -10], max: [50, 40] },
        modelTop: 0,
        holes: [
          { centre: [20, 50], diameter: 6, top: 0, bottom: -5, blocked: false },
        ],
        pockets: [pocket("A", 20), pocket("B", 40)],
        profiles: [
          {
            id: "outline",
            name: "Outline",
            face: face("f:bottom", -10),
            z: -10,
            side: "outside",
            footprint: { min: [0, 0], max: [40, 30] },
          },
        ],
      },
      [flat6],
      machine,
    );
    expect(plan.unplanned).toEqual([
      { feature: "Stock top", reason: "blocked by toe clamp 1" },
      { feature: "Hole 6 mm at (20, 50)", reason: "blocked by toe clamp 1" },
      { feature: "Pocket A", reason: "blocked by toe clamp 1" },
      { feature: "Outline", reason: "blocked by toe clamp 1" },
    ]);
    expect(plan.operations.map(({ name }) => name)).toEqual([
      "Pocket, Pocket B",
    ]);
  });

  describe("on the stock layer", () => {
    beforeAll(() => {
      vi.stubGlobal("document", { documentElement: {} });
      vi.stubGlobal("getComputedStyle", () => ({
        getPropertyValue: () => "#888888",
      }));
    });
    afterAll(() => vi.unstubAllGlobals());

    it("draws saved hold-downs and the dialog's live ones in the warning colour", () => {
      const { name: _name, fixtures: _fixtures, ...stocked } = setup([]);
      const open: OpenProject = {
        projectId: "p1",
        document: {
          extensions: {
            [CAM_EXTENSION]: {
              version: 4,
              data: {
                setups: [{ ...stocked, fixtures: fixturesOf([clamp]) }],
                tools: [],
              },
            },
          },
        } as unknown as CadDocument,
        bodies: [
          {
            id: "b1",
            name: "Body 1",
            bbox: { min: [0, 0, -10], max: [40, 30, 0] },
          },
        ],
      };
      const project = {
        get: () => open,
        subscribe: () => () => {},
      } as unknown as ProjectView;
      const preview = {
        get: () => ({ simulation: { status: "idle" } }),
        subscribe: () => () => {},
      } as unknown as ToolpathPreview;
      const draft = holdDownDraft();
      const group = new THREE.Group();
      const layer = {
        group,
        requestRender: () => {},
        clearGroup: (g: THREE.Object3D) => g.clear(),
      } as unknown as ViewportLayer;
      const unmount = stockLayer(project, preview, draft).mount(layer);
      const warned = () => {
        const found: THREE.Box3[] = [];
        group.traverse((o) => {
          if (
            o instanceof THREE.LineSegments &&
            o.material.userData.themeToken === "warn"
          )
            found.push(new THREE.Box3().setFromObject(o));
        });
        return found;
      };
      group.updateMatrixWorld(true);
      expect(warned()).toHaveLength(1);
      const [saved] = warned();
      expect([saved!.min.toArray(), saved!.max.toArray()]).toEqual([
        [5, 18, 0],
        [15, 38, 10],
      ]);
      draft.set({
        setup: stocked,
        fixtures: fixturesOf([clamp, { ...clamp, kind: "tape" }, clamp]),
      });
      expect(warned()).toHaveLength(3);
      draft.set(null);
      expect(warned()).toHaveLength(1);
      if (unmount) unmount();
    });
  });
});
