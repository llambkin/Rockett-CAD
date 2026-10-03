export type NumberFormat = { decimals: number; trim: boolean };

export type Capabilities = {
  arcs: boolean | "xy";
  cycles: boolean;
  toolChange: boolean;
};

type Spec = {
  needs: string[];
  may?: string[];
  unless?: keyof Capabilities | "always";
};

export const AXES = new Set(["x", "y", "z"]);
const CYCLE = ["x", "y", "clear", "top", "bottom", "feed", "dwell"];
const PLANE_ONLY = new Set(["k", "plane"]);

const TEMPLATES = {
  header: { needs: ["units", "offset"] },
  footer: { needs: [] },
  toolChange: { needs: [], may: ["tool"], unless: "toolChange" },
  toolLength: { needs: [], may: ["tool"], unless: "always" },
  spindleCw: { needs: ["rpm"] },
  spindleCcw: { needs: ["rpm"] },
  spindleOff: { needs: [] },
  coolantFlood: { needs: [] },
  coolantMist: { needs: [] },
  coolantOff: { needs: [] },
  rapid: { needs: [...AXES] },
  linear: { needs: [...AXES, "feed"] },
  arcCw: { needs: [...AXES, "i", "j", "k", "feed", "plane"], unless: "arcs" },
  arcCcw: { needs: [...AXES, "i", "j", "k", "feed", "plane"], unless: "arcs" },
  drill: { needs: [], may: CYCLE, unless: "cycles" },
  drillDwell: { needs: [], may: CYCLE, unless: "always" },
  peck: { needs: [], may: [...CYCLE, "peck"], unless: "cycles" },
  cycleEnd: { needs: [], unless: "cycles" },
  dwell: { needs: ["seconds"] },
  stop: { needs: [] },
  optionalStop: { needs: [] },
} satisfies Record<string, Spec>;

export type TemplateName = keyof typeof TEMPLATES;

export type Post = {
  id: string;
  label: string;
  extension: string;
  capabilities: Capabilities;
  toolChangeDefault?: boolean;
  words: string[];
  formats: Record<string, NumberFormat>;
  modal: (string | string[])[];
  workOffsets: string[];
  templates: Record<TemplateName, string[]> & { comment: string };
};

export type Token =
  | { kind: "literal"; word: string }
  | { kind: "word"; name: string }
  | { kind: "number"; letter: string; name: string };

export const UNITS = { mm: "G21", inch: "G20" } as const;
export const PLANES = { xy: "G17", zx: "G18", yz: "G19" } as const;
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

const WORD_VARS = new Set(["units", "offset", "plane"]);
const LITERAL = /^[A-Z][-+]?\d+(?:\.\d+)?$/;
const WORD_VAR = /^\{([a-z]+)\}$/;
const NUMBER_VAR = /^([A-Z])\{([a-z]+)\}$/;
const COMMENT = /^(\(|; ?)\{text\}(\)?)$/;
const KEYS = [
  "id",
  "label",
  "extension",
  "capabilities",
  "toolChangeDefault",
  "words",
  "formats",
  "modal",
  "workOffsets",
  "templates",
];

export function commentForm(line: unknown) {
  const [, open, close] =
    typeof line === "string" ? (COMMENT.exec(line) ?? []) : [];
  return open !== undefined && (open === "(") === (close === ")")
    ? { open, close: close ?? "" }
    : undefined;
}

export function token(text: string): Token | undefined {
  if (LITERAL.test(text)) return { kind: "literal", word: text };
  const word = WORD_VAR.exec(text);
  if (word) return { kind: "word", name: word[1]! };
  const number = NUMBER_VAR.exec(text);
  return number
    ? { kind: "number", letter: number[1]!, name: number[2]! }
    : undefined;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function unknownKeys(value: Json, keys: string[], path: string) {
  return Object.keys(value)
    .filter((key) => !keys.includes(key))
    .map((key) => `${path}${key}: unknown key`);
}

function scalars(post: Json): string[] {
  const problems: string[] = [];
  for (const [key, pattern] of [
    ["id", /^[a-z0-9][a-z0-9.-]*$/],
    ["label", /^[ -~]+$/],
    ["extension", /^[a-z0-9]+$/],
  ] as const)
    if (typeof post[key] !== "string" || !pattern.test(post[key]))
      problems.push(`${key}: must match ${pattern.source}`);
  const caps = post.capabilities;
  if (
    post.toolChangeDefault !== undefined &&
    typeof post.toolChangeDefault !== "boolean"
  )
    problems.push("toolChangeDefault: must be a boolean");
  if (!isRecord(caps)) return [...problems, "capabilities: must be an object"];
  problems.push(
    ...unknownKeys(caps, ["arcs", "cycles", "toolChange"], "capabilities."),
  );
  if (typeof caps.arcs !== "boolean" && caps.arcs !== "xy")
    problems.push('capabilities.arcs: must be a boolean or "xy"');
  for (const key of ["cycles", "toolChange"])
    if (typeof caps[key] !== "boolean")
      problems.push(`capabilities.${key}: must be a boolean`);
  return problems;
}

function dialect(post: Json): string[] {
  const problems: string[] = [];
  const words = isStrings(post.words) ? post.words : [];
  if (!isStrings(post.words)) problems.push("words: must be a list of words");
  words.forEach((word, i) => {
    if (!LITERAL.test(word)) problems.push(`words[${i}]: malformed word`);
  });
  const formats = isRecord(post.formats) ? post.formats : {};
  if (!isRecord(post.formats)) problems.push("formats: must be an object");
  for (const [letter, format] of Object.entries(formats)) {
    if (!/^[A-FH-LP-Z]$/.test(letter))
      problems.push(
        `formats.${letter}: must be an address letter other than G, M, N or O`,
      );
    else if (
      !isRecord(format) ||
      !Number.isInteger(format.decimals) ||
      (format.decimals as number) < 0 ||
      (format.decimals as number) > 6 ||
      typeof format.trim !== "boolean"
    )
      problems.push(`formats.${letter}: must be { decimals: 0 to 6, trim }`);
  }
  return problems;
}

function modal(post: Post): string[] {
  if (!Array.isArray(post.modal)) return ["modal: must be a list"];
  const grouped = new Set<string>();
  return post.modal.flatMap((entry, i) => {
    if (typeof entry === "string")
      return Object.hasOwn(post.formats, entry)
        ? []
        : [`modal[${i}]: ${entry} has no number format`];
    if (!isStrings(entry)) return [`modal[${i}]: must be a letter or a list`];
    return entry.flatMap((word) => {
      if (!post.words.includes(word))
        return [`modal[${i}]: ${word} is not in words`];
      if (grouped.has(word))
        return [`modal[${i}]: ${word} is already in a modal group`];
      grouped.add(word);
      return [];
    });
  });
}

function offsets(post: Post): string[] {
  if (!isStrings(post.workOffsets) || !post.workOffsets.length)
    return ["workOffsets: must be a non-empty list of words"];
  return post.workOffsets
    .map((word, i) => ({ word, i }))
    .filter(({ word }) => !post.words.includes(word))
    .map(({ word, i }) => `workOffsets[${i}]: ${word} is not in words`);
}

function tokenProblems(post: Post, name: TemplateName, found: Token): string {
  if (found.kind === "literal")
    return post.words.includes(found.word)
      ? ""
      : `${found.word} is not in words`;
  const spec: Spec = TEMPLATES[name];
  const allowed = [...spec.needs, ...(spec.may ?? [])];
  if (!allowed.includes(found.name))
    return `{${found.name}} is not a ${name} variable`;
  if (found.kind === "word" && !WORD_VARS.has(found.name))
    return `{${found.name}} needs an address letter`;
  if (found.kind === "number" && WORD_VARS.has(found.name))
    return `{${found.name}} is a whole word`;
  if (found.kind === "number" && !Object.hasOwn(post.formats, found.letter))
    return `${found.letter} has no number format`;
  return "";
}

function template(post: Post, name: TemplateName): string[] {
  const path = `templates.${name}`;
  const lines = post.templates[name];
  if (!isStrings(lines)) return [`${path}: must be a list of lines`];
  const { unless }: Spec = TEMPLATES[name];
  const needs = TEMPLATES[name].needs.filter(
    (need) => post.capabilities.arcs !== "xy" || !PLANE_ONLY.has(need),
  );
  if (!lines.length) {
    if (unless === "always" || (unless && !post.capabilities[unless]))
      return [];
    return unless
      ? [`${path}: must not be empty when capabilities.${unless} is true`]
      : [`${path}: must not be empty`];
  }
  const used = new Set<string>();
  const problems = lines.flatMap((line, i) =>
    line.split(" ").flatMap((text) => {
      const found = token(text);
      if (!found) return [`${path}[${i}]: malformed token`];
      if (found.kind !== "literal") used.add(found.name);
      const problem = tokenProblems(post, name, found);
      return problem ? [`${path}[${i}]: ${problem}`] : [];
    }),
  );
  return [
    ...problems,
    ...needs
      .filter((need) => !used.has(need))
      .map((need) => `${path}: needs {${need}}`),
  ];
}

function templates(post: Post): string[] {
  if (!isRecord(post.templates)) return ["templates: must be an object"];
  const problems = unknownKeys(
    post.templates,
    [...TEMPLATE_NAMES, "comment"],
    "templates.",
  );
  for (const name of TEMPLATE_NAMES) problems.push(...template(post, name));
  if (!commentForm(post.templates.comment))
    problems.push(
      "templates.comment: must be a line with one {text} after a ( or ; opener",
    );
  const planes =
    post.capabilities.arcs !== "xy" &&
    (post.templates.arcCw?.length || post.templates.arcCcw?.length);
  const needed = [UNITS.mm, ...(planes ? Object.values(PLANES) : [])];
  for (const word of needed.filter((w) => !post.words.includes(w)))
    problems.push(`words: needs ${word}`);
  return problems;
}

export function validatePost(value: unknown): string[] {
  if (!isRecord(value)) return ["post: must be an object"];
  const problems = [
    ...unknownKeys(value, KEYS, ""),
    ...scalars(value),
    ...dialect(value),
  ];
  if (
    !isRecord(value.capabilities) ||
    !isStrings(value.words) ||
    !isRecord(value.formats)
  )
    return problems;
  const post = value as Post;
  return [...problems, ...modal(post), ...offsets(post), ...templates(post)];
}
