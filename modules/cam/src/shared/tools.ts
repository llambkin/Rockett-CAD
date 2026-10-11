import { Type, type Static } from "typebox";

const coolant = Type.Union([
  Type.Literal("off"),
  Type.Literal("flood"),
  Type.Literal("mist"),
]);

export type Coolant = Static<typeof coolant>;

const body = {
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  diameter: Type.Number(),
  fluteLength: Type.Number(),
  overallLength: Type.Number(),
  shankDiameter: Type.Number(),
  flutes: Type.Number(),
  centreCutting: Type.Boolean(),
};

export const toolSchema = Type.Union([
  Type.Object({
    ...body,
    kind: Type.Union([Type.Literal("flat"), Type.Literal("ball")]),
  }),
  Type.Object({
    ...body,
    kind: Type.Literal("bull"),
    cornerRadius: Type.Number(),
  }),
  Type.Object({
    ...body,
    kind: Type.Union([
      Type.Literal("vbit"),
      Type.Literal("drill"),
      Type.Literal("chamfer"),
    ]),
    tipAngle: Type.Number(),
  }),
]);

export type Tool = Static<typeof toolSchema>;

export const TOOL_KINDS: [Tool["kind"], string][] = [
  ["flat", "Flat end mill"],
  ["ball", "Ball end mill"],
  ["bull", "Bull nose end mill"],
  ["vbit", "V-bit"],
  ["drill", "Drill"],
  ["chamfer", "Chamfer mill"],
];

export const MM_PER_INCH = 25.4;

const CORNER_RADIUS = 1;
const TIP_ANGLE = 90;

export const newTool = (count: number): Tool => ({
  id: crypto.randomUUID(),
  name: `Tool ${count + 1}`,
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
});

export function withKind(tool: Tool, kind: Tool["kind"]): Tool {
  const { cornerRadius, tipAngle, ...rest } = tool as Tool & {
    cornerRadius?: number;
    tipAngle?: number;
  };
  if (kind === "bull")
    return { ...rest, kind, cornerRadius: cornerRadius ?? CORNER_RADIUS };
  if (kind === "flat" || kind === "ball") return { ...rest, kind };
  return { ...rest, kind, tipAngle: tipAngle ?? TIP_ANGLE };
}

const presetBody = {
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  rpm: Type.Number(),
  cutFeed: Type.Number(),
  plungeFeed: Type.Number(),
  rampFeed: Type.Number(),
  stepdown: Type.Number(),
  stepoverFraction: Type.Number(),
  coolant,
  profile: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
};

export const storedPresetSchema = Type.Object(presetBody);

export const presetSchema = Type.Object({
  ...presetBody,
  toolId: Type.Optional(Type.String({ minLength: 1 })),
});

export type Preset = Static<typeof presetSchema>;

export const newPreset = (count: number, toolId?: string): Preset => ({
  id: crypto.randomUUID(),
  name: `Preset ${count + 1}`,
  ...(toolId ? { toolId } : {}),
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 300,
  stepdown: 1,
  stepoverFraction: 0.4,
  coolant: "off",
});

export const presetFits = (preset: Preset, tool: Tool) =>
  preset.toolId === undefined || preset.toolId === tool.id;

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
