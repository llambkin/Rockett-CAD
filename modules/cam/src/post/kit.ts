import grbl from "../../posts/grbl.json";
import linuxcnc from "../../posts/linuxcnc.json";
import { POST_MAX_BYTES, USER_POST_PREFIX } from "../shared/document.js";
import {
  NEVER_MODAL,
  postSchema,
  TEMPLATE_NAMES,
  TEMPLATES,
  WORD_VARS,
  type Spec,
  importPostProblems,
  type TemplateName,
} from "./schema.js";

export const POST_KIT_FILE = "rockett-post-kit.md";

const code = (text: string) => `\`${text}\``;
const json = (value: unknown) =>
  ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => "---"), ...rows]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");

const INSTRUCTION = [
  "# Rockett post kit",
  "",
  "This file is for an AI assistant. The user pastes it, then their current post processor, and asks for a Rockett post.",
  "",
  "## Instruction to the assistant",
  "",
  "Convert the post the user gives you into one Rockett declarative post.",
  "",
  "1. Read the old post and find what it writes: units, arcs and their planes, canned cycles, tool change and tool length lines, spindle, coolant, dwell, stops, comments and number formats.",
  "2. Write a JSON post that passes the JSON schema below and every rule in Rules the schema cannot state. Start from the GRBL example at the end and change only what the old post does differently.",
  "3. Keep the old post's behaviour: its units words, its arc form (planes and incremental centres), its canned cycles or none, and its tool change and tool length lines.",
  "4. Give the post an `id` and `label` for the user's machine.",
  "5. Templates are data. Never put code, expressions, conditions or keys the schema does not list into the JSON.",
  '6. Reply with the JSON post in one `json` code block, then a list headed "Cannot express" with one line for each behaviour of the old post this format has no place for, or "None". Write nothing else.',
  "7. If Rockett refuses the import, the user pastes the refusal line back. Fix what it names and reply the same way with the whole corrected post.",
  "",
  "Things this format cannot express include chip-breaking drilling (Fusion `chip-breaking`, G73), tapping (Fusion `tapping`, `left-tapping` and `right-tapping`, G84 and G74), boring and reaming (Fusion `boring`, `reaming` and their variants, G85 to G89 and G76), absolute arc centres (G90.1), probing, subprograms and macros, variables and expressions, conditional output, rotary axes, line numbers and manual tool length tables. List each one the old post uses under Cannot express.",
].join("\n");

const HOW = [
  "## How a post works",
  "",
  "Rockett plans toolpaths in mm, converts them to the output units, then writes each line from a template. A template is a list of lines. Each line is tokens separated by single spaces, and each token is one of:",
  "",
  "- a word listed in `words`, as `G1` or `M30`;",
  "- a whole word variable, `{units}`, `{offset}` or `{plane}`;",
  "- an address letter and a variable, as `X{x}`, written with the letter's number format from `formats`.",
  "",
  "A token whose variable has no value is left out, and a motion line with no axis left is not written. Each output file runs: Rockett's comment block, naming the program, kernel, post and input; the laser note, in a laser file; header; for each tool, toolChange and toolLength when tool change is on; for each section, the spindle and coolant lines, then its moves; footer. With tool change off, a new file starts at each change of tool, so tools A, B, A make three files. Rockett checks every line it writes against `words` and `formats`.",
].join("\n");

const WHEN: Record<TemplateName, string> = {
  header: "Once at the start of each file.",
  footer: "Once at the end of each file.",
  toolChange:
    "Before each tool when tool change is on. With it off, each run of one tool gets its own file.",
  toolLength: "Right after toolChange.",
  spindleCw: "At the start of each section that turns the spindle clockwise.",
  spindleCcw:
    "At the start of each section that turns the spindle counterclockwise.",
  spindleOff: "At the start of each section with no spindle.",
  coolantFlood: "After the spindle line of a section with flood coolant.",
  coolantMist: "After the spindle line of a section with mist coolant.",
  coolantOff: "After the spindle line of a section with no coolant.",
  rapid: "For each rapid move.",
  linear: "For each feed move.",
  arcCw:
    "For each clockwise arc whose plane capabilities.arcs allows. The two axes in the arc's plane are always written.",
  arcCcw:
    "For each counterclockwise arc whose plane capabilities.arcs allows. The two axes in the arc's plane are always written.",
  drill: "For each hole of a drilling cycle when capabilities.cycles is true.",
  drillDwell:
    "Instead of drill for a drilling cycle with a dwell, when it is not [].",
  peck: "For each hole of a peck drilling cycle when capabilities.cycles is true.",
  cycleEnd: "After the last hole of each cycle.",
  dwell: "For each dwell.",
  stop: "For a program stop.",
  optionalStop: "For an optional stop.",
  accelerationProfile:
    "Before a move whose acceleration profile differs from the last, when the machine profile turns acceleration profiles on.",
};

const VARIABLES: Record<string, string> = {
  units: "G21 for mm output or G20 for inch output.",
  offset: "The setup's work offset, taken from workOffsets.",
  plane: "G17, G18 or G19, the arc's plane.",
  x: "Target X in output units.",
  y: "Target Y in output units.",
  z: "Target Z in output units.",
  i: "Arc centre X minus arc start X (incremental).",
  j: "Arc centre Y minus arc start Y (incremental).",
  k: "Arc centre Z minus arc start Z (incremental).",
  feed: "Feed rate in output units per minute.",
  power: "Laser power as an S value, 0 to the machine's maximum.",
  tool: "Tool number.",
  rpm: "Spindle speed in revolutions per minute.",
  clear: "Cycle retract height (the R plane).",
  top: "Top of the hole.",
  bottom: "Bottom of the hole.",
  dwell: "Dwell at the bottom of the hole, in seconds.",
  peck: "Depth of each peck.",
  seconds: "Dwell time in seconds.",
  profile: "Acceleration profile number, 1 for rapids and roughing.",
};

const tokens = (names: string[] = []) =>
  names.map((name) => code(`{${name}}`)).join(" ") || "none";

function mayBeEmpty(spec: Spec) {
  if (spec.optional) return "may be left out";
  if (spec.unless === "always") return "yes";
  return spec.unless ? `when capabilities.${spec.unless} is false` : "no";
}

const templateTable = () =>
  [
    "## Templates",
    "",
    "Every template below is a key of `templates`, plus `comment`. A template uses only its own variables and must contain its required ones.",
    "",
    table(
      ["Template", "Required", "Optional", "May be []", "Called"],
      TEMPLATE_NAMES.map((name) => {
        const spec: Spec = TEMPLATES[name];
        return [
          code(name),
          tokens(spec.needs),
          tokens(spec.may),
          mayBeEmpty(spec),
          WHEN[name],
        ];
      }),
    ),
  ].join("\n");

function variableTable() {
  const names = [
    ...new Set(
      TEMPLATE_NAMES.flatMap((name) => {
        const spec: Spec = TEMPLATES[name];
        return spec.needs.concat(spec.may ?? []);
      }),
    ),
  ];
  const rows = names.map((name) => {
    const meaning = VARIABLES[name];
    if (!meaning) throw new Error(`post kit has no meaning for {${name}}`);
    const form = WORD_VARS.has(name) ? "whole word" : "letter and number";
    return [code(`{${name}}`), form, meaning];
  });
  return ["## Variables", "", table(["Variable", "Form", "Value"], rows)].join(
    "\n",
  );
}

const SWITCHES = [
  "## Dialect switches",
  "",
  '- `capabilities.arcs`: `true` writes arcs in all three planes through arcCw and arcCcw. `"xy"` writes XY arcs only, turns other arcs into short lines, and drops `{k}` and `{plane}` from the required variables. `false` turns every arc into short lines within 0.005 mm, and the arc templates may be [].',
  "- `capabilities.cycles`: `true` writes drilling through drill, drillDwell, peck and cycleEnd. `false` expands every cycle into rapid, linear and dwell lines, and the cycle templates may be [].",
  "- `capabilities.toolChange`: `true` lets one file hold several tools through toolChange and toolLength, when the export dialog's tool change choice is M6. `false` refuses tool change, so each run of one tool gets its own file.",
  "- `toolChangeDefault`: accepted, but export never reads it. The machine profile and the export dialog choose tool change. Leave it out.",
  "- `laser`: present when the post can run a laser. `note` is written as a comment before the header of each laser file, `on` replaces the spindle lines of each section, and linear, arcCw and arcCcw must contain `{power}`.",
  "- Units: the header's `{units}` writes G21 or G20, and Rockett converts every number before formatting. `words` must hold G21. A post without G20 imports, but export refuses inch output with it.",
  "- Comments: `templates.comment` is `({text})`, `;{text}` or `; {text}`. Rockett replaces `(`, `)`, `;` and characters outside printable ASCII in comment text with spaces.",
  "- Drilling: start drill, drillDwell and peck with G99 where the controller has it, as `G99 G81 X{x} Y{y} Z{bottom} R{clear} F{feed}`. Rockett moves between holes at `{clear}`.",
  "- Acceleration profiles: `templates.accelerationProfile` may be left out. It is written only when the machine profile turns acceleration profiles on.",
  "- `formats`: the decimals of each address letter, and whether trailing zeros are dropped.",
  "- `modal`: an address letter listed alone is written only when its value changes. A list of words is a modal group, written only when the word differs from the group's last one. Everything is written again after a tool change, a cycle and raw lines. Modal applies to every template, so a footer M5 is left out when the spindle is already off. The two axes in an arc's plane are always written.",
].join("\n");

const refusal = (post: object) => code(importPostProblems(post)[0]!);
const either = (items: string[]) =>
  `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

const RULES = [
  "## Rules the schema cannot state",
  "",
  "Rockett checks these at import, after the JSON schema passes.",
  "",
  "- Every word in a template line, a `modal` group, `workOffsets` and `laser.on` is listed in `words`.",
  "- An address letter in a template line, and a letter listed alone in `modal`, has a number format in `formats`.",
  "- `{units}`, `{offset}` and `{plane}` stand alone. Every other variable follows its address letter, as `X{x}`.",
  "- A template uses only the variables its row in Templates lists, and contains every required one.",
  "- A template is [] only where its row allows it.",
  "- A word is in at most one modal group.",
  "- With `laser`, linear, arcCw and arcCcw contain `{power}`, as `S{power}`.",
  '- `words` holds G21. When the post has arc templates and `capabilities.arcs` is not `"xy"`, `words` also holds G17, G18 and G19.',
  `- \`modal\` never lists ${either(NEVER_MODAL)} alone: arc centres and dwell times are written on every line that uses them. Refused as ${refusal({ ...grbl, modal: [...grbl.modal, "I"] })}.`,
  `- \`accelerationProfile\` is left out, never []. Refused as ${refusal({ ...grbl, templates: { ...grbl.templates, accelerationProfile: [] } })}.`,
  `- With \`capabilities.cycles\` true, a drill with a dwell writes \`{dwell}\`: through drillDwell, or through drill when drillDwell is []. Refused as ${refusal({ ...linuxcnc, templates: { ...linuxcnc.templates, drillDwell: [] } })}. A peck cycle writes a dwell only through \`{dwell}\` in peck.`,
  "",
  "Rockett checks these at export, against the lines it wrote. A post that breaks one imports, then every export with it is refused.",
  "",
  "- The footer repeats every spindleOff and coolantOff line word for word, as `M5` and `M9`. Refused as `the post footer never sends M5`.",
  "- G20, G21 and the work offset words appear only through the header's `{units}` and `{offset}`. A fixed G21 in the header is refused as `the file sets units G21 G21, not G21`, and a fixed G54 in the footer as `the file sets work offset G54 G54, not G54`.",
  "- With tool change on, toolChange has one line with `{tool}` and at least one fixed word, as `T{tool} M6`, because Rockett finds each tool change in the file by those words. `{tool}` alone is refused as `the file changes to tools ..., not ...`.",
  "- `workOffsets` is in order: entry n is the setup's work offset n, so G54 is 1 and G55 is 2. A setup with work offset 2 and a post with one entry is refused as `post <id> has no work offset 2`.",
].join("\n");

const IMPORT = [
  "## Import and refusals",
  "",
  `Import post in Settings, CAM, Posts takes one JSON file of at most ${POST_MAX_BYTES} bytes in UTF-8. Rockett adds ${code(USER_POST_PREFIX)} to the id, so a user post never replaces a shipped one, and importing the same id again replaces the earlier copy. The post as Rockett stores it, with no spaces and with the new id, must also fit in ${POST_MAX_BYTES} bytes.`,
  "",
  "A refusal is one line naming the JSON path, the problem and the accepted values, as:",
  "",
  "```text",
  `Post did not import: post ${importPostProblems({ ...grbl, capabilities: { ...grbl.capabilities, arcs: "yes" } })[0]}.`,
  "```",
  "",
  "Delete in Settings, CAM, Posts removes a user post. Setups that use it keep their own copy and still export.",
].join("\n");

const MAPPING = [
  "## Mapping from other posts",
  "",
  "Each cell names where the source usually keeps the same behaviour. Where a cell says check, look for your post's equivalent.",
  "",
  table(
    ["Rockett", "Fusion .cps", "Vectric .pp", "Mach3 and Mach4", "LinuxCNC"],
    [
      ["`header`", "`onOpen()`", "`begin HEADER`", "check", "check"],
      ["`footer`", "`onClose()`", "`begin FOOTER`", "check", "`M2` or `M30`"],
      [
        "`toolChange`",
        "the tool call in `onSection()`",
        "`begin TOOLCHANGE`",
        "`T{tool} M6`",
        "`T{tool} M6`",
      ],
      [
        "`toolLength`",
        "`tool.lengthOffset` in `onSection()`",
        "check",
        "`G43 H{tool}`",
        "`G43 H{tool}`",
      ],
      [
        "`spindleCw`, `spindleCcw`",
        "`spindleSpeed` and `tool.clockwise`",
        "`[S]` in the header or tool change",
        "`M3 S{rpm}`, `M4 S{rpm}`",
        "`M3 S{rpm}`, `M4 S{rpm}`",
      ],
      [
        "coolant templates",
        "`tool.coolant`",
        "check",
        "`M8`, `M7`, `M9`",
        "`M8`, `M7`, `M9`",
      ],
      ["`rapid`", "`onRapid()`", "`begin RAPID_MOVE`", "`G0`", "`G0`"],
      [
        "`linear`",
        "`onLinear()`",
        "`begin FIRST_FEED_MOVE`, `begin FEED_MOVE`",
        "`G1`",
        "`G1`",
      ],
      [
        "`arcCw`, `arcCcw`",
        "`onCircular()`",
        "`begin CW_ARC_MOVE`, `begin CCW_ARC_MOVE`",
        "`G2`, `G3`; in Mach3 the IJ mode setting picks incremental or absolute centres, and Rockett writes incremental",
        "`G2`, `G3`, incremental centres by default (`G91.1`)",
      ],
      [
        "`capabilities.arcs`",
        "`allowedCircularPlanes`",
        "check",
        "check",
        "`G17`, `G18`, `G19`",
      ],
      [
        "`drill`, `drillDwell`, `peck`, `cycleEnd`",
        "`onCyclePoint()`, `onCycleEnd()`; `cycleType` `drilling`, `counter-boring`, `deep-drilling`",
        "check",
        "`G81`, `G82`, `G83`, `G80`",
        "`G81`, `G82`, `G83`, `G80`, with `R` retract and `Q` peck",
      ],
      [
        "`dwell`",
        "`onDwell()`",
        "`begin DWELL_MOVE`",
        "`G4 P`; in Mach3 a setting picks seconds or milliseconds",
        "`G4 P` in seconds",
      ],
      [
        "`stop`, `optionalStop`",
        "`onCommand()` with `COMMAND_STOP`, `COMMAND_OPTIONAL_STOP`",
        "check",
        "`M0`, `M1`",
        "`M0`, `M1`",
      ],
      [
        "`comment`",
        "`onComment()`",
        "check",
        "`({text})` in the Mach3 manual",
        "`({text})` or `; {text}`",
      ],
      [
        "`formats`",
        "`createFormat()` decimals",
        "the format in each `VAR` line, as `1.3`",
        "check",
        "check",
      ],
      [
        "`modal`",
        "`createModal()`, `createVariable()`",
        "`A` always or `C` on change in each `VAR` line",
        "check",
        "check",
      ],
      ["units", "`unit`", "the `UNITS` line", "`G21`, `G20`", "`G21`, `G20`"],
      ["`extension`", "`extension`", "`FILE_EXTENSION`", "check", "check"],
    ],
  ),
].join("\n");

export function postKit(): string {
  return [
    INSTRUCTION,
    HOW,
    templateTable(),
    variableTable(),
    SWITCHES,
    RULES,
    IMPORT,
    MAPPING,
    ["## JSON schema", "", json(postSchema)].join("\n"),
    [
      "## Example: GRBL 1.1",
      "",
      "The shipped GRBL 1.1 post, complete. Copy its shape.",
      "",
      json(grbl),
    ].join("\n"),
  ]
    .join("\n\n")
    .concat("\n");
}
