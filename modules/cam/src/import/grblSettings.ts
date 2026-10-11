import { Value } from "typebox/value";
import { machineSchema, type MachineProfile } from "../shared/machine.js";

export const MAX_SETTINGS_TEXT = 65536;

const LINE = /^\s*\$(\d+)=(\S*)/;
const NUMBER = /^-?\d+(\.\d*)?$/;

const number = (text: string) => (NUMBER.test(text) ? Number(text) : null);

const MODES: Record<string, boolean> = { "0": false, "1": true, "2": false };

const mode = (text: string) => MODES[text] ?? null;

const SETTINGS = [
  ["$110", "maxFeedX", number],
  ["$111", "maxFeedY", number],
  ["$112", "maxFeedZ", number],
  ["$120", "accelX", number],
  ["$121", "accelY", number],
  ["$122", "accelZ", number],
  ["$11", "junctionDeviation", number],
  ["$30", "rpmMax", number],
  ["$31", "rpmMin", number],
  ["$32", "laserMode", mode],
] as const;

export function importGrblSettings(text: string, machine: MachineProfile) {
  if (text.length > MAX_SETTINGS_TEXT)
    throw new Error(`$$ output is over ${MAX_SETTINGS_TEXT} characters`);
  const found = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    if (match) found.set(`$${match[1]}`, match[2]!);
  }
  const laser = mode(found.get("$32") ?? "") ?? machine.laserMode === true;
  const filled: Partial<MachineProfile> = {};
  const missing: string[] = [];
  for (const [setting, key, read] of SETTINGS) {
    if (laser && (key === "rpmMax" || key === "rpmMin")) continue;
    const raw = found.get(setting);
    const value = raw === undefined ? null : read(raw);
    if (value !== null && Value.Check(machineSchema.properties[key], value))
      Object.assign(filled, { [key]: value });
    else missing.push(setting);
  }
  return { machine: { ...machine, ...filled }, missing };
}
