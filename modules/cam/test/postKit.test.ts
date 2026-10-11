import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { postKit } from "../src/post/kit.js";
import {
  TEMPLATE_NAMES,
  TEMPLATES,
  importPostProblems,
  validatePost,
  type Post,
  type Spec,
} from "../src/post/schema.js";
import { POSTS } from "../src/server/posts.js";
import { golden, loadPost } from "./goldens.js";
import {
  add,
  call,
  copyOf,
  generate,
  grbl,
  mine,
  nc,
  project,
  setup,
  userMine,
} from "./helpers/postServer.js";

const POSTS_PATH = "/m/rockett/cam/posts";
const kit = postKit();

const fenced = (heading: string) =>
  JSON.parse(
    kit
      .split(`\n## ${heading}\n`)[1]!
      .split("```json\n")[1]!
      .split("\n```")[0]!,
  );

const many = (key: (i: number) => string, value: unknown) =>
  Object.fromEntries(Array.from({ length: 9 }, (_, i) => [key(i), value]));

const { footer: _footer, ...noFooter } = grbl.templates;
const { label: _label, ...noLabel } = grbl;

const refusals: [string, unknown][] = [
  ["an unknown key", { ...grbl, script: "x" }],
  ["a missing label", noLabel],
  ["an id with spaces", { ...grbl, id: "My Post" }],
  [
    "an arcs value",
    { ...grbl, capabilities: { ...grbl.capabilities, arcs: "yes" } },
  ],
  [
    "an unknown capability",
    { ...grbl, capabilities: { ...grbl.capabilities, probe: true } },
  ],
  ["a lower case word", { ...grbl, words: [...grbl.words, "g1"] }],
  [
    "a G number format",
    { ...grbl, formats: { ...grbl.formats, G: { decimals: 0, trim: true } } },
  ],
  [
    "seven decimals",
    { ...grbl, formats: { ...grbl.formats, X: { decimals: 7, trim: true } } },
  ],
  ["no work offsets", { ...grbl, workOffsets: [] }],
  ["a missing template", { ...grbl, templates: noFooter }],
  [
    "an unknown template",
    { ...grbl, templates: { ...grbl.templates, probe: ["G38.2"] } },
  ],
  [
    "a comment with no opener",
    { ...grbl, templates: { ...grbl.templates, comment: "{text}" } },
  ],
  ["a laser that never turns on", { ...grbl, laser: { note: "x", on: [] } }],
  [
    "nine unknown keys",
    {
      ...grbl,
      id: "junk",
      capabilities: { ...grbl.capabilities, arcs: "yes" },
      ...many((i) => `script${i}`, "x"),
    },
  ],
  [
    "nine unknown templates",
    {
      ...grbl,
      templates: { ...grbl.templates, ...many((i) => `script${i}`, ["G0"]) },
    },
  ],
  [
    "nine bad formats letters",
    {
      ...grbl,
      formats: {
        ...grbl.formats,
        ...many((i) => `x${i}`, { decimals: 1, trim: true }),
      },
    },
  ],
];

const refusal = async (text: string) => {
  try {
    await add(text);
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error("the import was accepted");
};

describe("post kit", () => {
  it("equals the committed post-kit.md", async () => {
    await readFile(new URL("../docs/post-kit.md", import.meta.url), "utf8");
    await expect(kit).toMatchFileSnapshot("../docs/post-kit.md");
  });

  it("sends the user to Settings, CAM, Posts and never to the Library panel", () => {
    expect(kit).toContain(
      "Import post in Settings, CAM, Posts takes one JSON file",
    );
    expect(kit).toContain(
      "Delete in Settings, CAM, Posts removes a user post.",
    );
    expect(kit).not.toContain("Library panel");
  });

  it("has a schema that accepts all six shipped posts", () => {
    const schema = fenced("JSON schema");
    expect(POSTS.size).toBe(6);
    for (const post of POSTS.values())
      expect(Value.Check(schema, post)).toBe(true);
  });

  it.each(refusals)(
    "has a schema that rejects %s, as the importer does",
    async (_name, post) => {
      expect(Value.Check(fenced("JSON schema"), post)).toBe(false);
      const [problem] = validatePost(post);
      expect(problem).toMatch(/^[\w.[\]]+: [^\n]+; accepted: [^\n]+$/);
      expect(await refusal(JSON.stringify(post))).toMatchObject({
        code: "validation",
        message: `post ${problem}`,
      });
    },
  );

  it("names every template and token in schema.ts", () => {
    for (const name of TEMPLATE_NAMES) {
      const spec: Spec = TEMPLATES[name];
      expect(kit).toContain(`| \`${name}\` |`);
      for (const variable of [...spec.needs, ...(spec.may ?? [])])
        expect(kit).toContain(`\`{${variable}}\``);
    }
  });

  it("names the path, the problem and the accepted values in one line", async () => {
    const rapid = {
      ...grbl,
      templates: { ...grbl.templates, rapid: ["G0 X{x} Y{y} Z{z} F{feed}"] },
    };
    expect(validatePost(rapid)).toEqual([
      "templates.rapid[0]: {feed} is not a rapid variable; accepted: {x}, {y}, {z}",
    ]);
    expect(validatePost({ ...grbl, script: "x" })).toEqual([
      "script: unknown key; accepted: id, label, extension, capabilities, toolChangeDefault, words, formats, modal, workOffsets, laser, templates",
    ]);
    expect(
      [
        5,
        { ...grbl, capabilities: 5 },
        { ...grbl, templates: 5 },
        { ...grbl, laser: 5 },
        { ...grbl, formats: {} },
      ].map((post) => validatePost(post)[0]),
    ).toEqual([
      "(top level): is not an object; accepted: a post object",
      "capabilities: is not an object; accepted: an object { arcs, cycles, toolChange }",
      "templates: is not an object; accepted: an object with one key per template, plus comment",
      "laser: is not an object; accepted: an object { note, on }",
      "modal[4]: X has no number format; accepted: a letter given a number format in formats, which is empty",
    ]);
    expect((await refusal(JSON.stringify(refusals[3]![1]))).message).toBe(
      'post capabilities.arcs: is not an accepted value; accepted: true, false or "xy"',
    );
    expect(kit).toContain(
      'Post did not import: post capabilities.arcs: is not an accepted value; accepted: true, false or "xy".',
    );
  });
});

const exportsGolden = async (doc: ReturnType<typeof project>, id: string) => {
  const out = await nc(doc, id);
  if (!("nc" in out)) throw new Error(JSON.stringify(out));
  const lines = out.nc.split("\n");
  expect(lines[2]).toBe(`(post ${id})`);
  expect(lines.slice(4).join("\n")).toBe(golden(grbl, "contour", 1)[0]);
};

const grblhal = loadPost("grblhal");
const linuxcnc = loadPost("linuxcnc");
const templated = (base: Post, id: string, templates: object) => ({
  ...base,
  id,
  label: id,
  templates: { ...base.templates, ...templates },
});

async function exported(
  post: Post,
  { toolChange = "perFile", offsetIndex = 1 } = {},
): Promise<string> {
  const saved = await add(JSON.stringify(post));
  const copy = saved.data.find((p: Post) => p.id === `user.${post.id}`);
  const wcs = { ...setup.wcs, offsetIndex };
  const doc = project([{ ...setup, wcs, post: copyOf(copy) }]);
  await generate(doc);
  try {
    const out = await nc(doc, copy.id, toolChange);
    if ("blocked" in out) return out.blocked.map((b) => b.reason).join("\n");
    return "reason" in out ? out.reason : "exported";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("post kit rules", () => {
  it.each([
    [
      "a footer that does not repeat spindleOff",
      templated(grbl, "no-stop", { footer: ["M9", "M30"] }),
      {},
      "the post footer never sends M5",
    ],
    [
      "a units word outside {units}",
      templated(grbl, "units", {
        header: ["G90 G94 G91.1 G17 G21 {units}", "{offset}"],
      }),
      {},
      "the file sets units G21 G21, not G21",
    ],
    [
      "a work offset word outside {offset}",
      templated(grbl, "offset", { footer: ["G54", "M5", "M9", "M30"] }),
      {},
      "the file sets work offset G54 G54, not G54",
    ],
    [
      "a tool change line with no fixed word",
      templated(grblhal, "bare-tool", { toolChange: ["M5", "M9", "T{tool}"] }),
      { toolChange: "m6" },
      "the file changes to tools",
    ],
    [
      "a work offset index past the end of workOffsets",
      { ...grbl, id: "one-offset", label: "One offset", workOffsets: ["G54"] },
      { offsetIndex: 2 },
      "has no work offset 2",
    ],
  ])(
    "refuses %s at export, as the kit says",
    async (_name, post, options, message) => {
      expect(await exported(post, options)).toContain(message);
      expect(kit).toContain(message);
    },
  );

  it.each([
    [
      "an empty accelerationProfile",
      templated(grbl, "accel", { accelerationProfile: [] }),
    ],
    ["an arc centre letter in modal", { ...grbl, modal: [...grbl.modal, "I"] }],
    [
      "a drill cycle that drops the dwell",
      templated(linuxcnc, "no-dwell", {
        drillDwell: [],
        drill: ["G81 X{x} Y{y} Z{bottom} R{clear} F{feed}"],
      }),
    ],
  ])("refuses %s at import, as the kit says", async (_name, post) => {
    const [problem] = importPostProblems(post);
    expect(problem).toMatch(/^[\w.[\]]+: [^\n]+; accepted: [^\n]+$/);
    expect(await refusal(JSON.stringify(post))).toMatchObject({
      message: `post ${problem}`,
    });
    expect(kit).toContain(problem);
  });

  it("keeps every arc centre and dwell letter out of modal", () => {
    for (const letter of ["I", "J", "K", "P"])
      expect(
        importPostProblems({ ...grbl, modal: [...grbl.modal, letter] }),
      ).toEqual([
        expect.stringMatching(`^modal\\[9\\]: ${letter} must be written`),
      ]);
    expect(kit).toContain("`modal` never lists I, J, K or P alone");
  });

  it("ships posts that keep every dwell", () => {
    for (const post of POSTS.values())
      expect(importPostProblems(post)).toEqual([]);
    expect(linuxcnc.templates.drillDwell).not.toEqual([]);
  });
});

describe("post kit round trip", () => {
  it("imports the GRBL example and exports the GRBL golden byte for byte", async () => {
    const example = fenced("Example: GRBL 1.1");
    expect(example).toEqual(grbl);
    const saved = await add(JSON.stringify(example));
    const post = saved.data.find((p: Post) => p.id === "user.grbl");
    const doc = project([{ ...setup, post: copyOf(post) }]);
    await generate(doc);
    await exportsGolden(doc, "user.grbl");
  });

  it("deletes a user post from the library and a setup holding its copy still exports", async () => {
    const saved = await add(JSON.stringify(mine));
    const doc = project([{ ...setup, post: copyOf(userMine) }]);
    await generate(doc);
    const left = await call("PUT", POSTS_PATH, {
      data: saved.data.filter((p: Post) => p.id !== userMine.id),
      etag: saved.etag,
    });
    expect(left.data.map((p: Post) => p.id)).not.toContain(userMine.id);
    expect(await call("GET", POSTS_PATH, undefined)).toEqual(left);
    await exportsGolden(doc, userMine.id);
  });

  it("refuses a library write holding a shipped id or an invalid post", async () => {
    const before = await call("GET", POSTS_PATH, undefined);
    for (const [post, message] of [
      [grbl, "post grbl: id must start with user."],
      [
        { ...userMine, templates: { ...grbl.templates, linear: ["G1"] } },
        "post user.my-grbl: templates.linear: needs {x}",
      ],
      [
        { ...userMine, script: "x" },
        "post user.my-grbl: script: unknown key; accepted: id, label",
      ],
      [
        { ...userMine, ...many((i) => `script${i}`, "x") },
        "post user.my-grbl: script0: unknown key; accepted: id, label",
      ],
    ] as const)
      await expect(
        call("PUT", POSTS_PATH, { data: [post], etag: before.etag }),
      ).rejects.toThrow(message);
    expect(await call("GET", POSTS_PATH, undefined)).toEqual(before);
  });
});
