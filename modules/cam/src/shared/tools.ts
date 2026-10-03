export type Coolant = "off" | "flood" | "mist";

export type Tool = {
  id: string;
  name: string;
  diameter: number;
  fluteLength: number;
  overallLength: number;
  shankDiameter: number;
  flutes: number;
  centreCutting: boolean;
} & (
  | { kind: "flat" | "ball" }
  | { kind: "bull"; cornerRadius: number }
  | { kind: "vbit" | "drill" | "chamfer"; tipAngle: number }
);

export type Preset = {
  id: string;
  name: string;
  rpm: number;
  cutFeed: number;
  plungeFeed: number;
  rampFeed: number;
  stepdown: number;
  stepoverFraction: number;
  coolant: Coolant;
};

export function validateTool(tool: Tool): string[] {
  const problems: string[] = [];
  if (!(tool.diameter > 0)) problems.push("diameter must be greater than 0");
  if (
    tool.kind === "bull" &&
    !(tool.cornerRadius >= 0 && tool.cornerRadius <= tool.diameter / 2)
  )
    problems.push("corner radius must be between 0 and half the diameter");
  return problems;
}

export function validatePreset(preset: Preset): string[] {
  return (["cutFeed", "plungeFeed", "rampFeed"] as const)
    .filter((key) => !(preset[key] > 0))
    .map((key) => `${key} must be greater than 0`);
}
