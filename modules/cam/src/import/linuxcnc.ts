import type { Units } from "../post/normalise.js";
import {
  MM_PER_INCH,
  newTool,
  validateTool,
  withKind,
  type Tool,
} from "../shared/tools.js";
import type { Reject, ToolImport } from "./rockett.js";

const WORD = /^([TPXYZABCUVWDIJQ])([+-]?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?)$/i;
const TOOL_NUMBER = /^\d+$/;

function words(data: string) {
  const found = new Map<string, string>();
  for (const token of data.split(/\s+/).filter(Boolean)) {
    const match = WORD.exec(token);
    if (!match) return `${token} is not a tool table word`;
    const letter = match[1]!.toUpperCase();
    if (found.has(letter)) return `${letter} appears twice`;
    found.set(letter, match[2]!);
  }
  return found;
}

export function importLinuxcnc(
  text: string,
  units: Units,
  kind: Tool["kind"],
): ToolImport {
  const scale = units === "inch" ? MM_PER_INCH : 1;
  const tools: Tool[] = [];
  const rejects: Reject[] = [];
  const numbers = new Set<string>();
  const read = (data: string, comment: string) => {
    const found = words(data);
    if (typeof found === "string") return found;
    const number = found.get("T");
    const diameter = found.get("D");
    if (number === undefined) return "has no tool number T";
    if (!TOOL_NUMBER.test(number)) return `T${number} is not a tool number`;
    if (numbers.has(number)) return `T${number} appears twice`;
    if (diameter === undefined) return "has no diameter D";
    const tool = {
      ...withKind(newTool(tools.length), kind),
      name: comment || `T${number}`,
      diameter: Number(diameter) * scale,
    };
    const problem = validateTool(tool)[0];
    if (problem) return problem;
    numbers.add(number);
    tools.push(tool);
  };
  text.split("\n").forEach((line, index) => {
    const [data = "", ...comment] = line.split(";");
    if (!data.trim()) return;
    const reason = read(data, comment.join(";").trim());
    if (reason) rejects.push({ item: `Line ${index + 1}`, reason });
  });
  return { tools, presets: [], rejects };
}
