import {
  Type,
  type Static,
  type TArray,
  type TOptional,
  type TString,
} from "typebox";
import { Value } from "typebox/value";

export type Spec = {
  needs: string[];
  may?: string[];
  unless?: "arcs" | "cycles" | "toolChange" | "always";
  optional?: true;
};

export const AXES = new Set(["x", "y", "z"]);
const CYCLE = ["x", "y", "clear", "top", "bottom", "feed", "dwell"];
const ARC = [...AXES, "i", "j", "k", "feed", "plane"];
const PLANE_ONLY = new Set(["k", "plane"]);
const POWERED = new Set<string>(["linear", "arcCw", "arcCcw"]);
export const NEVER_MODAL = ["I", "J", "K", "P"];

export const TEMPLATES = {
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
  linear: { needs: [...AXES, "feed"], may: ["power"] },
  arcCw: { needs: ARC, may: ["power"], unless: "arcs" },
  arcCcw: { needs: ARC, may: ["power"], unless: "arcs" },
  drill: { needs: [], may: CYCLE, unless: "cycles" },
  drillDwell: { needs: [], may: CYCLE, unless: "always" },
  peck: { needs: [], may: [...CYCLE, "peck"], unless: "cycles" },
  cycleEnd: { needs: [], unless: "cycles" },
  dwell: { needs: ["seconds"] },
  stop: { needs: [] },
  optionalStop: { needs: [] },
  accelerationProfile: { needs: ["profile"], optional: true },
} satisfies Record<string, Spec>;

export type TemplateName = keyof typeof TEMPLATES;

export type Token =
  | { kind: "literal"; word: string }
  | { kind: "word"; name: string }
  | { kind: "number"; letter: string; name: string };

export const UNITS = { mm: "G21", inch: "G20" } as const;
export const PLANES = { xy: "G17", zx: "G18", yz: "G19" } as const;
export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];
export const WORD_VARS = new Set(["units", "offset", "plane"]);

const LITERAL = /^[A-Z][-+]?\d+(?:\.\d+)?$/;
const WORD_VAR = /^\{([a-z]+)\}$/;
const NUMBER_VAR = /^([A-Z])\{([a-z]+)\}$/;
const COMMENT = /^(?:(\()\{text\}\)|(; ?)\{text\})$/;
const IN_WORDS = "accepted: a word listed in words";

const printable = Type.String({
  pattern: "^[ -~]+$",
  description: "printable ASCII text",
});

const lineList = Type.Array(Type.String(), {
  description:
    "a list of template lines, tokens separated by single spaces, [] for none",
});

type Templates = {
  [K in TemplateName]: K extends "accelerationProfile"
    ? TOptional<TArray<TString>>
    : TArray<TString>;
};

const numberFormat = Type.Object(
  {
    decimals: Type.Integer({
      minimum: 0,
      maximum: 6,
      description: "a whole number from 0 to 6",
    }),
    trim: Type.Boolean({
      description: "true drops trailing zeros, false keeps them",
    }),
  },
  { description: "an object { decimals, trim }" },
);

const templateSchema = Type.Object(
  {
    ...(Object.fromEntries(
      TEMPLATE_NAMES.map((name) => [
        name,
        (TEMPLATES[name] as Spec).optional ? Type.Optional(lineList) : lineList,
      ]),
    ) as Templates),
    comment: Type.String({
      pattern: COMMENT.source,
      description: '"({text})", ";{text}" or "; {text}"',
    }),
  },
  {
    additionalProperties: false,
    description: "an object with one key per template, plus comment",
  },
);

export const postSchema = Type.Object(
  {
    id: Type.String({
      pattern: "^[a-z0-9][a-z0-9.-]*$",
      description:
        "lower case letters, digits, dots and hyphens, starting with a letter or digit",
    }),
    label: printable,
    extension: Type.String({
      pattern: "^[a-z0-9]+$",
      description: 'lower case letters and digits with no dot, as "nc"',
    }),
    capabilities: Type.Object(
      {
        arcs: Type.Union([Type.Boolean(), Type.Literal("xy")], {
          description: 'true, false or "xy"',
        }),
        cycles: Type.Boolean({ description: "true or false" }),
        toolChange: Type.Boolean({ description: "true or false" }),
      },
      {
        additionalProperties: false,
        description: "an object { arcs, cycles, toolChange }",
      },
    ),
    toolChangeDefault: Type.Optional(
      Type.Boolean({ description: "true or false" }),
    ),
    words: Type.Array(
      Type.String({
        pattern: LITERAL.source,
        description: "a capital letter and a number, as G1, M30 or G91.1",
      }),
      { description: "a list of every G and M word the post writes" },
    ),
    formats: Type.Record(
      Type.String({ pattern: "^[A-FH-LP-Z]$" }),
      numberFormat,
      {
        additionalProperties: false,
        description: "address letters other than G, M, N and O",
      },
    ),
    modal: Type.Array(Type.Union([Type.String(), Type.Array(Type.String())]), {
      description: "a list of address letters and lists of words",
    }),
    workOffsets: Type.Array(Type.String(), {
      minItems: 1,
      description: "a non-empty list of words, as G54",
    }),
    laser: Type.Optional(
      Type.Object(
        {
          note: printable,
          on: Type.Array(Type.String(), {
            minItems: 1,
            description: "a non-empty list of lines of words",
          }),
        },
        { additionalProperties: false, description: "an object { note, on }" },
      ),
    ),
    templates: templateSchema,
  },
  { additionalProperties: false, description: "a post object" },
);

export type Post = Static<typeof postSchema>;
export type NumberFormat = Static<typeof numberFormat>;

export function commentForm(line: unknown) {
  const [, paren, semi] =
    typeof line === "string" ? (COMMENT.exec(line) ?? []) : [];
  if (paren) return { open: paren, close: ")" };
  return semi === undefined ? undefined : { open: semi, close: "" };
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

type Node = { description?: string; properties?: Record<string, unknown> };

function nodeAt(schemaPath: string): Node | undefined {
  let node: unknown = postSchema;
  for (const key of schemaPath.split("/").slice(1))
    node = (node as Record<string, unknown> | undefined)?.[key];
  return node as Node | undefined;
}

function accepted(schemaPath: string, keys = false): string {
  const node = nodeAt(schemaPath);
  if (keys && node?.properties) return Object.keys(node.properties).join(", ");
  if (node?.description) return node.description;
  const parent = schemaPath.slice(0, schemaPath.lastIndexOf("/"));
  return parent ? accepted(parent) : "a post object";
}

const child = (path: string, key: string) =>
  /^\d+$/.test(key) ? `${path}[${key}]` : path ? `${path}.${key}` : key;

const article = (noun: string) =>
  `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;

const jsonPath = (pointer: string) =>
  pointer.split("/").slice(1).reduce(child, "");

const ROOT = "(top level)";

type SchemaError = ReturnType<typeof Value.Errors>[number];

function schemaProblem(error: SchemaError): string[] {
  const path = jsonPath(error.instancePath);
  const { schemaPath } = error;
  const parent = schemaPath.slice(0, schemaPath.lastIndexOf("/"));
  if (error.keyword === "additionalProperties")
    return error.params.additionalProperties.map(
      (key) =>
        `${child(path, key)}: unknown key; accepted: ${accepted(schemaPath, true)}`,
    );
  if (
    error.keyword === "boolean" &&
    schemaPath.endsWith("/additionalProperties")
  )
    return [`${path}: unknown key; accepted: ${accepted(parent, true)}`];
  if (error.keyword === "required")
    return error.params.requiredProperties.map(
      (key) =>
        `${child(path, key)}: is missing; accepted: ${accepted(`${schemaPath}/properties/${key}`)}`,
    );
  if (error.keyword === "boolean" || schemaPath.includes("/anyOf/")) return [];
  const problem =
    error.keyword === "anyOf"
      ? "is not an accepted value"
      : error.keyword === "type"
        ? `is not ${article(String(error.params.type))}`
        : error.message;
  return [`${path || ROOT}: ${problem}; accepted: ${accepted(schemaPath)}`];
}

function schemaProblems(value: unknown): string[] {
  if (Value.Check(postSchema, value)) return [];
  const problems = new Set(
    Value.Errors(postSchema, value).flatMap(schemaProblem),
  );
  return problems.size
    ? [...problems]
    : [`${ROOT}: does not match the JSON schema; accepted: a post object`];
}

function letters(post: Post) {
  const given = Object.keys(post.formats);
  return given.length
    ? `accepted: a letter in formats (${given.join(", ")})`
    : "accepted: a letter given a number format in formats, which is empty";
}

function modal(post: Post): string[] {
  const grouped = new Set<string>();
  return post.modal.flatMap((entry, i) => {
    if (typeof entry === "string")
      return Object.hasOwn(post.formats, entry)
        ? []
        : [`modal[${i}]: ${entry} has no number format; ${letters(post)}`];
    return entry.flatMap((word) => {
      if (!post.words.includes(word))
        return [`modal[${i}]: ${word} is not in words; ${IN_WORDS}`];
      if (grouped.has(word))
        return [
          `modal[${i}]: ${word} is already in a modal group; accepted: each word in one group`,
        ];
      grouped.add(word);
      return [];
    });
  });
}

function neverModal(post: Post): string[] {
  return post.modal.flatMap((entry, i) =>
    typeof entry === "string" && NEVER_MODAL.includes(entry)
      ? [
          `modal[${i}]: ${entry} must be written on every line that uses it; accepted: a letter in formats other than ${NEVER_MODAL.join(", ")}`,
        ]
      : [],
  );
}

function offsets(post: Post): string[] {
  return post.workOffsets
    .map((word, i) => ({ word, i }))
    .filter(({ word }) => !post.words.includes(word))
    .map(
      ({ word, i }) =>
        `workOffsets[${i}]: ${word} is not in words; ${IN_WORDS}`,
    );
}

function tokenProblems(post: Post, name: TemplateName, found: Token): string {
  if (found.kind === "literal")
    return post.words.includes(found.word)
      ? ""
      : `${found.word} is not in words; ${IN_WORDS}`;
  const spec: Spec = TEMPLATES[name];
  const allowed = [...spec.needs, ...(spec.may ?? [])];
  if (!allowed.includes(found.name))
    return `{${found.name}} is not a ${name} variable; accepted: ${allowed.map((v) => `{${v}}`).join(", ") || "no variables"}`;
  if (found.kind === "word" && !WORD_VARS.has(found.name))
    return `{${found.name}} needs an address letter; accepted: a letter in formats before it, as X{x}`;
  if (found.kind === "number" && WORD_VARS.has(found.name))
    return `{${found.name}} is a whole word; accepted: {${found.name}} with no letter`;
  if (found.kind === "number" && !Object.hasOwn(post.formats, found.letter))
    return `${found.letter} has no number format; ${letters(post)}`;
  return "";
}

function emptyProblem(post: Post, name: TemplateName): string[] {
  const { unless, optional } = TEMPLATES[name] as Spec;
  if (unless === "always" || (unless && !post.capabilities[unless])) return [];
  if (optional)
    return [
      `templates.${name}: must not be empty; accepted: at least one line, or leave the key out`,
    ];
  return unless
    ? [
        `templates.${name}: must not be empty when capabilities.${unless} is true; accepted: at least one line, or capabilities.${unless} false`,
      ]
    : [`templates.${name}: must not be empty; accepted: at least one line`];
}

function template(post: Post, name: TemplateName): string[] {
  const path = `templates.${name}`;
  const given = post.templates[name];
  const spec: Spec = TEMPLATES[name];
  if (given === undefined) return [];
  if (!given.length) return emptyProblem(post, name);
  const needs = [
    ...spec.needs.filter(
      (need) => post.capabilities.arcs !== "xy" || !PLANE_ONLY.has(need),
    ),
    ...(post.laser !== undefined && POWERED.has(name) ? ["power"] : []),
  ];
  const used = new Set<string>();
  const problems = given.flatMap((line, i) =>
    line.split(" ").flatMap((text) => {
      const found = token(text);
      if (!found)
        return [
          `${path}[${i}]: malformed token "${text}"; accepted: a word in words, {units}, {offset}, {plane}, or a letter and a variable as X{x}, separated by single spaces`,
        ];
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
  const problems = TEMPLATE_NAMES.flatMap((name) => template(post, name));
  const planes =
    post.capabilities.arcs !== "xy" &&
    (post.templates.arcCw.length || post.templates.arcCcw.length);
  const needed = [UNITS.mm, ...(planes ? Object.values(PLANES) : [])];
  for (const word of needed.filter((w) => !post.words.includes(w)))
    problems.push(`words: needs ${word}`);
  return problems;
}

function dwell({ capabilities, templates: t }: Post): string[] {
  const used = t.drillDwell.length ? t.drillDwell : t.drill;
  if (!capabilities.cycles || used.some((line) => line.includes("{dwell}")))
    return [];
  return t.drillDwell.length
    ? ["templates.drillDwell: needs {dwell}"]
    : [
        "templates.drillDwell: must not be empty when capabilities.cycles is true and templates.drill has no {dwell}; accepted: a line with P{dwell}, as G82 X{x} Y{y} Z{bottom} R{clear} P{dwell} F{feed}",
      ];
}

function laser(post: Post): string[] {
  return (post.laser?.on ?? []).flatMap((line, i) => {
    const bad = line.split(" ").filter((word) => !post.words.includes(word));
    return bad.length
      ? [`laser.on[${i}]: ${bad.join(" ")} is not in words; ${IN_WORDS}`]
      : [];
  });
}

export function validatePost(value: unknown): string[] {
  const problems = schemaProblems(value);
  if (problems.length) return problems;
  const post = value as Post;
  return [...modal(post), ...offsets(post), ...laser(post), ...templates(post)];
}

export function importPostProblems(value: unknown): string[] {
  const problems = validatePost(value);
  if (problems.length) return problems;
  const post = value as Post;
  return [...neverModal(post), ...dwell(post)];
}
