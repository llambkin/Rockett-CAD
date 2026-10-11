import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  availableWatts,
  machineSchema,
  newMachine,
  spindleRange,
  validateMachine,
  type MachineProfile,
} from "../src/shared/machine.js";
import {
  MAX_SETTINGS_TEXT,
  importGrblSettings,
} from "../src/import/grblSettings.js";

const machine: MachineProfile = { ...newMachine(0), id: "m1" };

const grbl = [
  "$0=10",
  "$11=0.010",
  "$30=24000.",
  "$31=0.",
  "$32=0",
  "$100=250.000",
  "$110=5000.000",
  "$111=5000.000",
  "$112=1500.000",
  "$120=400.000",
  "$121=400.000",
  "$122=150.000",
  "ok",
].join("\r\n");

const cam008 = {
  id: "m0",
  name: "Router",
  firmware: "grbl",
  post: "grbl",
  xMin: 0,
  xMax: 300,
  yMin: 0,
  yMax: 300,
  zMin: -80,
  zMax: 0,
  maxFeedX: 3000,
  maxFeedY: 3000,
  maxFeedZ: 1000,
  rpmMin: 0,
  rpmMax: 24000,
  toolChange: "perFile",
  units: "mm",
};

describe("GRBL $$ import", () => {
  it("reports a dump missing $122", () => {
    const dump = grbl.replace("$122=150.000\r\n", "");
    const { missing, machine: filled } = importGrblSettings(dump, machine);
    expect(missing).toEqual(["$122"]);
    expect(filled.accelZ).toBeUndefined();
  });

  it("fills every listed setting from a GRBL 1.1 dump", () => {
    expect(importGrblSettings(grbl, machine)).toEqual({
      machine: {
        ...machine,
        maxFeedX: 5000,
        maxFeedY: 5000,
        maxFeedZ: 1500,
        accelX: 400,
        accelY: 400,
        accelZ: 150,
        junctionDeviation: 0.01,
        rpmMax: 24000,
        rpmMin: 0,
        laserMode: false,
      },
      missing: [],
    });
  });

  it("reads grblHAL laser and lathe modes", () => {
    const laser = importGrblSettings("$32=1\n", machine);
    const lathe = importGrblSettings("$32=2\n", machine);
    expect(laser.machine.laserMode).toBe(true);
    expect(lathe.machine.laserMode).toBe(false);
    expect(lathe.missing).not.toContain("$32");
  });

  it("leaves the spindle rpm alone in laser mode", () => {
    const shop = { ...machine, rpmMin: 8000, rpmMax: 24000 };
    const dump = "$30=1000.\n$31=0.\n$32=1\n$110=5000.000\n";
    const laser = importGrblSettings(dump, shop);
    expect(laser.machine).toMatchObject({
      rpmMin: 8000,
      rpmMax: 24000,
      laserMode: true,
      maxFeedX: 5000,
    });
    expect(laser.missing).not.toContain("$30");
    expect(laser.missing).not.toContain("$31");
    const stored = importGrblSettings("$30=1000.\n", {
      ...shop,
      laserMode: true,
    });
    expect(stored.machine.rpmMax).toBe(24000);
  });

  it("lists values the profile cannot hold and keeps the old ones", () => {
    const dump = grbl
      .replace("$120=400.000", "$120=0.000")
      .replace("$30=24000.", "$30=24000.5")
      .replace("$32=0", "$32=3")
      .replace("$111=5000.000", "$111=");
    const { missing, machine: filled } = importGrblSettings(dump, machine);
    expect(missing).toEqual(["$111", "$120", "$30", "$32"]);
    expect(filled).toMatchObject({ maxFeedY: 3000, rpmMax: 24000 });
    expect(filled.accelX).toBeUndefined();
  });

  it("refuses text past its bound", () => {
    expect(() =>
      importGrblSettings("$".repeat(MAX_SETTINGS_TEXT + 1), machine),
    ).toThrow(`over ${MAX_SETTINGS_TEXT} characters`);
  });
});

describe("spindle limits", () => {
  it("a measured 21000 rpm beats a nameplate 24000", () => {
    expect(
      spindleRange({ ...machine, rpmMax: 24000, measuredRpmMax: 21000 }),
    ).toEqual({ min: 0, max: 21000 });
    expect(
      spindleRange({ ...machine, rpmMin: 8000, measuredRpmMin: 9000 }),
    ).toEqual({ min: 9000, max: 24000 });
  });

  it("falls in proportion below the rated rpm", () => {
    const rated = { ...machine, ratedWatts: 800, ratedRpm: 24000 };
    expect(availableWatts(rated, 12000)).toBe(400);
    expect(availableWatts(rated, 24000)).toBe(800);
    expect(availableWatts(rated, 30000)).toBe(800);
    expect(availableWatts(machine, 12000)).toBeUndefined();
  });

  it("refuses a measured range upside down and half a rating", () => {
    expect(
      validateMachine({
        ...machine,
        measuredRpmMin: 20000,
        measuredRpmMax: 18000,
      }),
    ).toEqual(["measured max spindle speed must be at least the min"]);
    expect(validateMachine({ ...machine, ratedWatts: 800 })).toEqual([
      "rated power needs both watts and rpm",
    ]);
  });

  it("loads a CAM-008 machine unchanged", () => {
    expect(Value.Check(machineSchema, cam008)).toBe(true);
    const old = cam008 as MachineProfile;
    expect(validateMachine(old)).toEqual([]);
    expect(spindleRange(old)).toEqual({ min: 0, max: 24000 });
    expect(availableWatts(old, 10000)).toBeUndefined();
  });
});
