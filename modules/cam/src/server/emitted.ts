import { dialectLine, NUMBER } from "../post/format.js";
import type { NormalisedProgram, Units } from "../post/normalise.js";
import {
  AXES,
  commentForm,
  token,
  UNITS,
  type Post,
  type TemplateName,
  type Token,
} from "../post/schema.js";

export type Expected = {
  units: Units;
  offsetIndex: number;
  toolChanges: number[];
};

export const expected = (
  normalised: NormalisedProgram,
  file: number,
  offsetIndex: number,
): Expected => ({
  units: normalised.units,
  offsetIndex,
  toolChanges: normalised.toolChange
    ? normalised.files[file]!.filter(
        (section, i, all) => section.toolId !== all[i - 1]?.toolId,
      ).map(
        ({ toolId }) =>
          normalised.tools.find(({ id }) => id === toolId)!.number,
      )
    : [],
});

const UNIT_WORDS: string[] = Object.values(UNITS);

const tokens = (post: Post, names: TemplateName[]) =>
  names.flatMap((name) =>
    (post.templates[name] ?? []).flatMap((line) =>
      line.split(" ").flatMap((text) => token(text) ?? []),
    ),
  );

const literals = (post: Post, names: TemplateName[]) =>
  new Set(
    tokens(post, names).flatMap((each) =>
      each.kind === "literal" ? [each.word] : [],
    ),
  );

const letterOf = (line: Token[], name: string) =>
  line.flatMap((each) =>
    each.kind === "number" && each.name === name ? [each.letter] : [],
  )[0];

function toolChangeLine(post: Post) {
  const line = post.templates.toolChange
    .map((text) => text.split(" ").map((each) => token(each)!))
    .find((each) => letterOf(each, "tool"));
  return (
    line && {
      letter: letterOf(line, "tool")!,
      words: line.flatMap((each) =>
        each.kind === "literal" ? [each.word] : [],
      ),
    }
  );
}

function dialect(post: Post) {
  const rapid = post.templates.rapid[0]!.split(" ").map((each) => token(each)!);
  return {
    comment: commentForm(post.templates.comment)!.open.trim(),
    axes: new Set(
      rapid.flatMap((each) =>
        each.kind === "number" && AXES.has(each.name) ? [each.letter] : [],
      ),
    ),
    feed: letterOf(tokens(post, ["linear"]), "feed"),
    rapid: literals(post, ["rapid"]),
    motion: literals(post, ["rapid", "linear", "arcCw", "arcCcw"]),
    on: new Set([
      ...literals(post, ["spindleCw", "spindleCcw"]),
      ...(post.laser?.on ?? []).flatMap((line) => line.split(" ")),
    ]),
    off: literals(post, ["spindleOff"]),
    change: toolChangeLine(post),
  };
}

export function emittedProblems(
  text: string,
  post: Post,
  want: Expected,
): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");
  if (lines.pop() !== "") problems.push("the file does not end in a newline");
  const d = dialect(post);
  const allowed = dialectLine(post);
  const state = { units: [] as string[], offsets: [] as string[], feed: false };
  let motion: string | undefined;
  let spindle = false;
  const changes: number[] = [];
  lines.forEach((line, i) => {
    const say = (what: string) => problems.push(`line ${i + 1}: ${what}`);
    if (!allowed(line)) say(`${line} is not in the ${post.id} dialect`);
    if (line.startsWith(d.comment)) return;
    const words = line.split(" ");
    for (const word of words) {
      if (UNIT_WORDS.includes(word)) state.units.push(word);
      if (post.workOffsets.includes(word)) state.offsets.push(word);
      if (d.motion.has(word)) motion = word;
      if (word[0] === d.feed && NUMBER.test(word)) state.feed = true;
      if (d.on.has(word)) spindle = true;
      if (d.off.has(word)) spindle = false;
    }
    const { change } = d;
    if (change && change.words.every((word) => words.includes(word)))
      changes.push(
        Number(words.find((word) => word[0] === change.letter)?.slice(1)),
      );
    if (!words.some((word) => d.axes.has(word[0]!))) return;
    if (state.units.length !== 1 || !state.offsets.length)
      say("moves before the units and work offset are set");
    if (!motion) say("moves with no motion mode in effect");
    else if (!d.rapid.has(motion)) {
      if (!state.feed) say("feeds with no feed rate in effect");
      if (!spindle) say("feeds with the spindle off");
    }
  });
  const units = state.units.join(" ") || "none";
  if (units !== UNITS[want.units])
    problems.push(`the file sets units ${units}, not ${UNITS[want.units]}`);
  const offsets = state.offsets.join(" ") || "none";
  const offset = post.workOffsets[want.offsetIndex - 1] ?? "none";
  if (offsets !== offset)
    problems.push(`the file sets work offset ${offsets}, not ${offset}`);
  const tools = changes.join(" ") || "none";
  const listed = want.toolChanges.join(" ") || "none";
  if (tools !== listed)
    problems.push(`the file changes to tools ${tools}, not ${listed}`);
  return problems;
}
