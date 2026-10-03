import { endOf, type Move, type Plane, type Xyz } from "../shared/ir.js";
import type { Coolant } from "../shared/tools.js";
import type { NormalisedProgram } from "./normalise.js";
import {
  AXES,
  commentForm,
  PLANES,
  TEMPLATE_NAMES,
  token,
  UNITS,
  validatePost,
  type NumberFormat,
  type Post,
  type TemplateName,
  type Token,
} from "./schema.js";

export type FormatOptions = { maxBytes?: number };

type Vars = Record<string, number | string | undefined>;

const MAX_BYTES = 64 * 1024 * 1024;
const MOTION = new Set<TemplateName>(["rapid", "linear"]);
const MAY_BE_EMPTY = new Set<TemplateName>(["toolChange", "toolLength"]);
const PLANE_AXES: Record<Plane, string[]> = {
  xy: ["x", "y"],
  zx: ["z", "x"],
  yz: ["y", "z"],
};
const CENTRE_WORDS: Record<Plane, string[]> = {
  xy: ["i", "j"],
  zx: ["i", "k"],
  yz: ["j", "k"],
};
const COOLANT: Record<Coolant, TemplateName> = {
  off: "coolantOff",
  flood: "coolantFlood",
  mist: "coolantMist",
};
const NUMBER = /^([A-Z])-?\d+(?:\.(\d+))?$/;

function number(value: number, format: NumberFormat): string {
  let text = value.toFixed(format.decimals);
  if (format.trim && text.includes(".")) text = text.replace(/\.?0+$/, "");
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

function clean(text: string): string {
  return text
    .replace(/[^ -~]|[();]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

class Writer {
  readonly lines: string[] = [];
  readonly modal = new Map<string, string>();
  private readonly templates: Record<TemplateName, Token[][]>;
  private readonly groups = new Map<string, string>();
  private readonly letters: Set<string>;
  private readonly words: Set<string>;
  private readonly comments: { open: string; close: string };

  constructor(
    private readonly post: Post,
    private readonly budget: { bytes: number; max: number },
  ) {
    this.templates = Object.fromEntries(
      TEMPLATE_NAMES.map((name) => [
        name,
        post.templates[name].map((line) =>
          line.split(" ").map((text) => token(text)!),
        ),
      ]),
    ) as Record<TemplateName, Token[][]>;
    post.modal.forEach((entry, i) => {
      if (Array.isArray(entry))
        for (const word of entry) this.groups.set(word, `#${i}`);
    });
    this.letters = new Set(post.modal.filter((e) => typeof e === "string"));
    this.words = new Set(post.words);
    this.comments = commentForm(post.templates.comment)!;
  }

  private allowed(line: string): boolean {
    const { open, close } = this.comments;
    if (line.startsWith(open.trim())) {
      const inner = line.slice(open.length, line.length - close.length);
      return line === `${open}${clean(inner)}${close}`;
    }
    return line.split(" ").every((word) => {
      if (this.words.has(word)) return true;
      const [, letter, fraction = ""] = NUMBER.exec(word) ?? [];
      const format = letter ? this.post.formats[letter] : undefined;
      return format !== undefined && fraction.length <= format.decimals;
    });
  }

  push(line: string) {
    if (!this.allowed(line))
      throw new Error(
        `line ${this.lines.length + 1} is not in the ${this.post.id} dialect: ${line}`,
      );
    this.budget.bytes += line.length + 1;
    if (this.budget.bytes > this.budget.max)
      throw new Error(`output is over ${this.budget.max} bytes`);
    this.lines.push(line);
  }

  comment(text: string) {
    const inner = clean(text);
    if (inner) this.push(`${this.comments.open}${inner}${this.comments.close}`);
  }

  hasTemplate(name: TemplateName) {
    return this.templates[name].length > 0;
  }

  emit(name: TemplateName, vars: Vars = {}, forced: string[] = []) {
    const lines = this.templates[name];
    if (!lines.length && !MAY_BE_EMPTY.has(name))
      throw new Error(`post ${this.post.id} has no ${name} template`);
    for (const line of lines) {
      const text = this.expand(line, vars, forced, MOTION.has(name));
      if (text) this.push(text);
    }
  }

  private value(each: Token, vars: Vars): string | undefined {
    if (each.kind === "literal") return each.word;
    const value = vars[each.name];
    if (each.kind === "word") return value as string;
    return typeof value === "number"
      ? number(value, this.post.formats[each.letter]!)
      : undefined;
  }

  private key(each: Token, value: string): string | undefined {
    if (each.kind !== "number") return this.groups.get(value);
    return this.letters.has(each.letter) ? each.letter : undefined;
  }

  private expand(line: Token[], vars: Vars, forced: string[], motion: boolean) {
    const changes = new Map<string, string>();
    const words: string[] = [];
    let axes = 0;
    for (const each of line) {
      const value = this.value(each, vars);
      if (value === undefined) continue;
      const key = this.key(each, value);
      const kept = each.kind !== "literal" && forced.includes(each.name);
      if (key && !kept && (changes.get(key) ?? this.modal.get(key)) === value)
        continue;
      if (key) changes.set(key, value);
      words.push(each.kind === "number" ? `${each.letter}${value}` : value);
      if (each.kind === "number" && AXES.has(each.name)) axes++;
    }
    if (!words.length || (motion && !axes)) return undefined;
    for (const [key, value] of changes) this.modal.set(key, value);
    return words.join(" ");
  }
}

function xyz([x, y, z]: Xyz): Vars {
  return { x, y, z };
}

function arcVars(move: Extract<Move, { kind: "arc" }>, at: Xyz): Vars {
  const vars: Vars = {
    ...xyz(move.to),
    feed: move.feed,
    plane: PLANES[move.plane],
  };
  ["i", "j", "k"].forEach((name, n) => {
    if (CENTRE_WORDS[move.plane].includes(name))
      vars[name] = move.centre[n]! - at[n]!;
  });
  return vars;
}

function writeMove(out: Writer, move: Move, at: Xyz | undefined) {
  if (move.kind === "rapid") return out.emit("rapid", xyz(move.to));
  if (move.kind === "feed")
    return out.emit("linear", { ...xyz(move.to), feed: move.feed });
  if (move.kind === "dwell")
    return out.emit("dwell", { seconds: move.seconds });
  if (move.kind === "comment") return out.comment(move.text);
  if (move.kind === "stop")
    return out.emit(move.optional ? "optionalStop" : "stop");
  if (move.kind === "arc") {
    if (!at) throw new Error("an arc has no start point in its file");
    const name = move.dir === "cw" ? "arcCw" : "arcCcw";
    return out.emit(name, arcVars(move, at), PLANE_AXES[move.plane]);
  }
  out.modal.clear();
  if (move.kind === "raw")
    for (const line of move.text.split(/\r?\n/)) out.push(line);
  if (move.kind === "cycle") {
    const { clear, top, bottom, feed, dwell } = move;
    const peck = move.cycle === "peck" ? move.peck : undefined;
    const name =
      move.cycle === "drill" && dwell && out.hasTemplate("drillDwell")
        ? "drillDwell"
        : move.cycle;
    for (const [x, y] of move.points)
      out.emit(name, { x, y, clear, top, bottom, feed, dwell, peck });
    out.emit("cycleEnd");
  }
  out.modal.clear();
}

export function formatProgram(
  program: NormalisedProgram,
  post: Post,
  options: FormatOptions,
): string[] {
  const problems = validatePost(post);
  if (problems.length) throw new Error(problems.join("\n"));
  if (program.postId !== post.id)
    throw new Error(
      `program is normalised for post ${program.postId}, not ${post.id}`,
    );
  const offset = post.workOffsets[program.offsetIndex - 1];
  if (!offset)
    throw new Error(
      `post ${post.id} has no work offset ${program.offsetIndex}`,
    );
  const budget = { bytes: 0, max: options.maxBytes ?? MAX_BYTES };
  return program.files.map((file) => {
    const out = new Writer(post, budget);
    out.emit("header", { units: UNITS[program.units], offset });
    let tool: string | undefined;
    let at: Xyz | undefined;
    for (const section of file) {
      if (section.toolId !== tool) {
        const found = program.tools.find((t) => t.id === section.toolId);
        if (!found) throw new Error(`tool ${section.toolId} is unknown`);
        if (program.toolChange) {
          out.emit("toolChange", { tool: found.number });
          out.emit("toolLength", { tool: found.number });
        }
        out.modal.clear();
        tool = section.toolId;
      }
      const { spindle } = section;
      if (!spindle) out.emit("spindleOff");
      else
        out.emit(spindle.dir === "cw" ? "spindleCw" : "spindleCcw", {
          rpm: spindle.rpm,
        });
      out.emit(COOLANT[section.coolant]);
      for (const move of section.moves) {
        writeMove(out, move, at);
        at = endOf(move, at);
      }
    }
    out.emit("footer");
    return `${out.lines.join("\n")}\n`;
  });
}
