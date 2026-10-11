import {
  MM_PER_INCH,
  type Coolant,
  type Preset,
  type Tool,
} from "../shared/tools.js";
import {
  exportTools,
  importRockett,
  type Reject,
  type ToolImport,
} from "./rockett.js";

export type FusionImport = ToolImport & { numbers: Record<string, number> };

type Fields = Record<string, unknown>;

const KINDS = new Map<unknown, Tool["kind"]>([
  ["flat end mill", "flat"],
  ["ball end mill", "ball"],
  ["bull nose end mill", "bull"],
  ["chamfer mill", "chamfer"],
  ["drill", "drill"],
]);

const SCALES = new Map<unknown, number>([
  ["millimeters", 1],
  ["inches", MM_PER_INCH],
]);

const COOLANTS = new Map<unknown, Coolant>([
  ["disabled", "off"],
  ["flood", "flood"],
  ["mist", "mist"],
]);

const fields = (value: unknown): Fields =>
  typeof value === "object" && value !== null ? (value as Fields) : {};

const number = (value: unknown) =>
  typeof value === "number" ? value : undefined;

const times = (value: unknown, scale: number) => {
  const found = number(value);
  return found === undefined ? undefined : found * scale;
};

function angle(kind: Tool["kind"], geometry: Fields) {
  if (kind === "chamfer") return times(geometry.TA, 2);
  if (kind === "drill") return number(geometry.SIG);
}

function toolOf(
  entry: Fields,
  kind: Tool["kind"],
  name: string,
  scale: number,
) {
  const geometry = fields(entry.geometry);
  const length = (key: string) => times(geometry[key], scale);
  return {
    id: entry.guid,
    name,
    kind,
    diameter: length("DC"),
    fluteLength: length("LCF"),
    overallLength: length("OAL"),
    shankDiameter: length("SFDM"),
    flutes: number(geometry.NOF),
    centreCutting: true,
    ...(kind === "bull" && { cornerRadius: length("RE") }),
    ...((kind === "chamfer" || kind === "drill") && {
      tipAngle: angle(kind, geometry),
    }),
  };
}

function used(preset: Fields, key: string, scale: number) {
  return preset[`use-${key}`] === false ? undefined : times(preset[key], scale);
}

function presets(
  entry: Fields,
  toolName: string,
  scale: number,
  rejects: Reject[],
) {
  const diameter = number(fields(entry.geometry).DC);
  const values = fields(entry["start-values"]).presets;
  return (Array.isArray(values) ? values : []).flatMap((value, index) => {
    const preset = fields(value);
    const name = typeof preset.name === "string" ? preset.name : "";
    const coolant = COOLANTS.get(preset["tool-coolant"]);
    const item = `${toolName}: ${name || `Preset ${index + 1}`}`;
    const reason = !name
      ? "has no name"
      : !coolant
        ? `tool-coolant ${JSON.stringify(preset["tool-coolant"])} is not a coolant Rockett imports`
        : undefined;
    if (reason) {
      rejects.push({ item, reason });
      return [];
    }
    const stepover = used(preset, "stepover", 1);
    const plungeFeed = times(preset.v_f_plunge, scale);
    return [
      {
        id: preset.guid,
        name: item,
        rpm: number(preset.n),
        cutFeed: times(preset.v_f, scale),
        plungeFeed,
        rampFeed: times(preset.v_f_ramp, scale) ?? plungeFeed,
        stepdown: used(preset, "stepdown", scale),
        stepoverFraction:
          stepover === undefined || diameter === undefined
            ? undefined
            : stepover / diameter,
        coolant,
      },
    ];
  });
}

function problem({ type, unit, geometry }: Fields) {
  const tip = number(fields(geometry)["tip-diameter"]);
  if (!KINDS.has(type))
    return `type ${JSON.stringify(type)} is not a tool type Rockett imports`;
  if (!SCALES.has(unit))
    return `unit ${JSON.stringify(unit)} is not millimeters or inches`;
  if (type === "chamfer mill" && tip !== undefined && tip > 0)
    return `tip-diameter ${tip} is above 0; Rockett chamfer mills come to a point`;
}

const refused = (reason: string): FusionImport => ({
  tools: [],
  presets: [],
  rejects: [{ item: "File", reason }],
  numbers: {},
});

export function importFusion(text: string): FusionImport {
  let body: { data?: unknown };
  try {
    body = fields(JSON.parse(text));
  } catch {
    return refused("is not JSON");
  }
  if (!Array.isArray(body.data)) return refused("is not a Fusion tool library");
  const rejects: Reject[] = [];
  const entries: { entry: Fields; tool: Tool; scale: number }[] = [];
  body.data.forEach((value, index) => {
    const entry = fields(value);
    const { description } = entry;
    const name =
      typeof description === "string" && description
        ? description
        : `Tool ${index + 1}`;
    const reason = entry === value ? problem(entry) : "must be object";
    if (reason) return void rejects.push({ item: name, reason });
    const kind = KINDS.get(entry.type)!;
    const scale = SCALES.get(entry.unit)!;
    entries.push({
      entry,
      tool: toolOf(entry, kind, name, scale) as Tool,
      scale,
    });
  });
  const checked = importRockett(
    exportTools(
      entries.map(({ tool }) => tool),
      [],
    ),
  );
  rejects.push(...checked.rejects);
  const kept = [...checked.tools];
  const found: unknown[] = [];
  const numbers: Record<string, number> = {};
  for (const { entry, tool, scale } of entries) {
    if (JSON.stringify(kept[0]) !== JSON.stringify(tool)) continue;
    kept.shift();
    found.push(...presets(entry, tool.name, scale, rejects));
    const value = fields(entry["post-process"]).number;
    if (Number.isInteger(value) && (value as number) >= 1)
      numbers[tool.id] = value as number;
  }
  const result = importRockett(exportTools(checked.tools, found as Preset[]));
  return { ...result, rejects: [...rejects, ...result.rejects], numbers };
}
