import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Hole } from "../src/kernel/holes.js";
import { newMachine, type MachineProfile } from "../src/shared/machine.js";
import type { FaceRef } from "../src/shared/params.js";
import {
  planOperations,
  type PlanFeatures,
  type PlanTool,
} from "../src/plan/plan.js";

const face = (bodyFace: string, z: number): FaceRef => ({
  kind: "face",
  bodyId: "b1",
  faceName: bodyFace,
  sig: { type: "plane", point: [0, 0, z], direction: [0, 0, 1] },
});

const body = {
  fluteLength: 30,
  overallLength: 60,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const flat12: PlanTool = {
  ...body,
  id: "t1",
  name: "T1 12 mm flat",
  kind: "flat",
  diameter: 12,
  shankDiameter: 12,
  flutes: 3,
  presets: [
    {
      id: "p1",
      name: "Aluminium rough",
      rpm: 12000,
      cutFeed: 1200,
      plungeFeed: 300,
      rampFeed: 400,
      stepdown: 2,
      stepoverFraction: 0.4,
      coolant: "mist",
    },
  ],
};

const flat4: PlanTool = {
  ...body,
  id: "t2",
  name: "T2 4 mm flat",
  kind: "flat",
  diameter: 4,
  fluteLength: 15,
  presets: [],
};

const drill6: PlanTool = {
  ...body,
  id: "t3",
  name: "T3 6 mm drill",
  kind: "drill",
  diameter: 6,
  tipAngle: 118,
  presets: [
    {
      id: "p3",
      name: "Aluminium drill",
      rpm: 3000,
      cutFeed: 200,
      plungeFeed: 150,
      rampFeed: 150,
      stepdown: 1,
      stepoverFraction: 0.5,
      coolant: "flood",
    },
  ],
};

const hole = (
  centre: [number, number],
  diameter: number,
  bottom: number,
  blocked = false,
): Hole => ({ centre, diameter, top: 10, bottom, blocked });

const plate: PlanFeatures = {
  stockTop: 12,
  stockOutline: { min: [0, 0], max: [60, 60] },
  modelTop: 10,
  holes: [hole([10, 10], 6, 0), hole([50, 50], 3, 4, true)],
  pockets: [
    {
      id: "pocketA",
      name: "Pocket A",
      floor: face("f:pocketA", 5),
      z: 5,
      width: 30,
      cornerRadius: 2,
      footprint: { min: [0, 0], max: [40, 40] },
    },
    {
      id: "slotB",
      name: "Slot B",
      floor: face("f:slotB", 7),
      z: 7,
      width: 7,
      cornerRadius: 1,
      footprint: { min: [0, 0], max: [40, 40] },
    },
  ],
  profiles: [
    {
      id: "window",
      name: "Window",
      face: face("f:window", 0),
      z: 0,
      side: "inside",
      opening: 0,
      width: 20,
      cornerRadius: 3,
      footprint: { min: [0, 0], max: [40, 40] },
    },
    {
      id: "outline",
      name: "Outline",
      face: face("f:bottom", 0),
      z: 0,
      side: "outside",
      footprint: { min: [0, 0], max: [40, 40] },
    },
  ],
};

const setup = { material: "aluminium6061", clearance: 3, fixtures: [] };

const machine = (toolChange: MachineProfile["toolChange"]): MachineProfile => ({
  ...newMachine(0),
  id: "m1",
  toolChange,
});

const tools = [flat12, flat4, drill6];

describe("planOperations", () => {
  it("plans the fixture plate as its golden plan, the same twice", () => {
    const golden = JSON.parse(
      readFileSync(new URL("golden/plan/plate.json", import.meta.url), "utf8"),
    );
    const plan = planOperations(setup, plate, tools, machine("perFile"));
    expect(plan).toEqual(golden);
    expect(
      planOperations(setup, plate, tools, machine("perFile")),
    ).toStrictEqual(plan);
  });

  it("pockets the 6 mm hole without the 6 mm drill", () => {
    const plan = planOperations(
      setup,
      plate,
      [flat12, flat4],
      machine("perFile"),
    );
    expect(
      plan.operations.some(({ type }) => type === "rockett.cam.drill"),
    ).toBe(false);
    expect(
      plan.operations.find(({ name }) => name.includes("Hole 6 mm")),
    ).toMatchObject({
      type: "rockett.cam.pocket",
      toolId: "t2",
      params: {
        hole: { centre: [10, 10], diameter: 6, top: 10, bottom: 0 },
      },
    });
  });

  it("keeps the spindle's tool first in a stage only on manual tool change", () => {
    const pocketsOnly = { ...plate, holes: [], profiles: [] };
    const order = (toolChange: MachineProfile["toolChange"]) =>
      planOperations(setup, pocketsOnly, tools, machine(toolChange))
        .operations.slice(1, 3)
        .map(({ name }) => name);
    expect(order("m6")).toEqual(["Pocket, Slot B", "Adaptive, Pocket A"]);
    expect(order("perFile")).toEqual(["Adaptive, Pocket A", "Pocket, Slot B"]);
  });

  it("reports a pocket no flat tool reaches instead of planning it", () => {
    const plan = planOperations(
      setup,
      { ...plate, holes: [], profiles: [] },
      [flat12, { ...flat4, fluteLength: 3 }],
      machine("m6"),
    );
    expect(plan.unplanned).toContainEqual({
      feature: "Slot B",
      reason: "no flat tool narrower than 7 mm reaches 5 mm deep",
    });
  });

  it("reports a tool with no preset when the setup names no material", () => {
    const plan = planOperations(
      { clearance: 3, fixtures: [] },
      plate,
      tools,
      machine("perFile"),
    );
    expect(plan.unplanned).toContainEqual({
      feature: "Window",
      reason: "T2 4 mm flat has no preset and the setup names no material",
    });
    expect(plan.operations.some(({ toolId }) => toolId === "t2")).toBe(false);
  });
});
