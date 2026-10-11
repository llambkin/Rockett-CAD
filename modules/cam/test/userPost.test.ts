import { describe, expect, it } from "vitest";
import { parse } from "@rockett/shared";
import {
  importPostProblems,
  validatePost,
  type Post,
} from "../src/post/schema.js";
import { POSTS } from "../src/server/posts.js";
import {
  CAM_EXTENSION,
  isCamData,
  migrateCam,
  POST_MAX_BYTES,
  saveCam,
  USER_POST_PREFIX,
  type CamData,
} from "../src/shared/document.js";
import { golden, loadPost } from "./goldens.js";
import {
  add,
  call,
  copyOf,
  generate,
  grbl,
  mark,
  mine,
  nc,
  posts,
  project,
  setup,
  userMine,
} from "./helpers/postServer.js";

const sized = (id: string) => {
  const post = { ...mine, id, label: "" };
  const room = POST_MAX_BYTES - Buffer.byteLength(JSON.stringify(post));
  return { ...post, label: "x".repeat(room) };
};

const linuxcnc = loadPost("linuxcnc");
const newer: [string, Post][] = [
  ...["I", "J", "K", "P"].map((letter): [string, Post] => [
    `${letter} alone in modal`,
    {
      ...userMine,
      id: `user.modal-${letter.toLowerCase()}`,
      modal: [...grbl.modal, letter],
    },
  ]),
  [
    "a cycles post whose drill dwell never reaches {dwell}",
    {
      ...linuxcnc,
      id: "user.no-dwell",
      templates: { ...linuxcnc.templates, drillDwell: [] },
    },
  ],
];

describe("CAM user posts", () => {
  it("exports the GRBL golden from a setup's copy after the library copy is deleted", async () => {
    const saved = await add(JSON.stringify(mine));
    expect(saved).toMatchObject({ version: 1, data: [userMine] });
    expect(await call("GET", "/m/rockett/cam/posts", undefined)).toEqual(saved);
    const doc = project([{ ...setup, post: copyOf(userMine) }]);
    await generate(doc);
    await posts.write(mark, [], saved.etag);
    expect((await posts.read(mark))?.data).toEqual([]);
    const out = await nc(doc, "user.my-grbl");
    if (!("nc" in out)) throw new Error(JSON.stringify(out));
    const lines = out.nc.split("\n");
    expect(lines[2]).toBe("(post user.my-grbl)");
    expect(lines.slice(4).join("\n")).toBe(golden(grbl, "contour", 1)[0]);
    const shipped = await nc(doc, "grbl");
    if (!("nc" in shipped)) throw new Error(JSON.stringify(shipped));
    expect(shipped.nc.split("\n")[2]).toBe("(post grbl)");
    expect(await nc(doc, "other")).toEqual({
      reason: "post other is not installed",
    });
  });

  it("stores every user post under the user. prefix, once", async () => {
    const first = await add(JSON.stringify({ ...mine, id: "twice" }));
    const next = await add(
      JSON.stringify({ ...mine, id: "user.twice", label: "Twice" }),
    );
    expect(next.etag).not.toBe(first.etag);
    expect(next.data.filter((p: any) => p.id.endsWith("twice"))).toEqual([
      { ...mine, id: "user.twice", label: "Twice" },
    ]);
    const grblCopy = await add(JSON.stringify(grbl));
    expect(grblCopy.data.map((p: any) => p.id)).toContain("user.grbl");
  });

  it("keeps the user. prefix out of every shipped post id", () => {
    expect(USER_POST_PREFIX).toBe("user.");
    for (const id of POSTS.keys())
      expect(id.startsWith(USER_POST_PREFIX)).toBe(false);
  });

  it.each([
    [
      "a post over the size bound",
      JSON.stringify({ ...mine, label: "x".repeat(POST_MAX_BYTES) }),
      new RegExp(`^post is \\d+ bytes, over the ${POST_MAX_BYTES} byte limit$`),
    ],
    [
      "whitespace padding past the size bound",
      JSON.stringify(mine) + " ".repeat(POST_MAX_BYTES),
      new RegExp(`^post is \\d+ bytes, over the ${POST_MAX_BYTES} byte limit$`),
    ],
    ["text that is not JSON", "{ id:", /^post is not JSON$/],
    [
      "a post missing a template variable",
      JSON.stringify({
        ...mine,
        templates: { ...mine.templates, linear: ["G1 X{x} Y{y} Z{z}"] },
      }),
      /^post templates\.linear: needs \{feed\}$/,
    ],
  ])("refuses %s with 400 naming it", async (_name, text, message) => {
    const before = await posts.read(mark);
    let error: any;
    try {
      await add(text);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: "validation", detail: "/post" });
    expect(error.message).toMatch(message);
    expect(await posts.read(mark)).toEqual(before);
  });

  it("bounds a post as the library stores it, so one post never blocks another's delete", async () => {
    await expect(add(JSON.stringify(sized("a")))).rejects.toMatchObject({
      code: "validation",
      message: `post is ${POST_MAX_BYTES + 5} bytes, over the ${POST_MAX_BYTES} byte limit`,
    });
    const fits = sized("user.a");
    await add(JSON.stringify(fits));
    const saved = await add(JSON.stringify({ ...mine, id: "small" }));
    const left = await call("PUT", "/m/rockett/cam/posts", {
      data: saved.data.filter((p: any) => p.id !== "user.small"),
      etag: saved.etag,
    });
    expect(left.data.map((p: any) => p.id)).toContain("user.a");
    expect(left.data.map((p: any) => p.id)).not.toContain("user.small");
    const copy = copyOf(fits);
    expect(isCamData({ setups: [{ id: "s1", post: copy }], tools: [] })).toBe(
      true,
    );
  });

  it.each(newer)(
    "refuses %s at import, yet a stored copy loads, exports and never blocks a delete",
    async (_name, post) => {
      const etag = (await posts.read(mark))?.etag ?? null;
      await posts.write(mark, [post, userMine], etag);
      const doc = project([{ ...setup, post: copyOf(post) }]);
      expect(migrateCam(doc.extensions[CAM_EXTENSION])).toMatchObject({
        status: "ready",
      });
      await generate(doc);
      expect(await nc(doc, post.id)).toHaveProperty("nc");
      const left = await call("PUT", "/m/rockett/cam/posts", {
        data: [post],
        etag: (await posts.read(mark))?.etag,
      });
      expect(left.data.map((p: Post) => p.id)).toEqual([post.id]);
      expect(validatePost(post)).toEqual([]);
      const [problem] = importPostProblems(post);
      expect(problem).toMatch(/^[\w.[\]]+: [^\n]+; accepted: [^\n]+$/);
      await expect(add(JSON.stringify(post))).rejects.toMatchObject({
        code: "validation",
        message: `post ${problem}`,
      });
    },
  );
});

describe("CAM setup post copies", () => {
  it("reads a v2 document saved without a setup post unchanged", () => {
    const data = { setups: [setup], tools: [] };
    const stored = { version: 2, data: structuredClone(data) };
    expect(migrateCam(stored)).toEqual({ status: "ready", data });
    expect(stored).toEqual({ version: 2, data });
  });

  it("refuses a setup copy without the user. prefix on every save", () => {
    const shadow = {
      setups: [{ ...setup, post: copyOf({ ...grbl, label: "Shadow" }) }],
      tools: [],
    };
    expect(isCamData(shadow)).toBe(false);
    expect(() => parse(saveCam.body, shadow)).toThrow(
      "setups.0.post id must start with user.",
    );
  });

  it("serves a shipped id from the shipped post, never a setup copy", async () => {
    const doc = project([{ ...setup, post: copyOf(userMine) }]);
    await generate(doc);
    const data = doc.extensions[CAM_EXTENSION]!.data as CamData;
    data.setups[0]!.post = copyOf({ ...grbl, label: "Shadow" }) as never;
    await expect(nc(doc, "grbl")).rejects.toThrow(
      "CAM data version 4 is not valid",
    );
  });

  it("bounds a setup copy by the post size limit", () => {
    const big = copyOf({ ...userMine, label: "x".repeat(POST_MAX_BYTES) });
    expect(isCamData({ setups: [{ id: "s1", post: big }], tools: [] })).toBe(
      false,
    );
  });

  it("refuses a setup copy that is not a valid post", () => {
    const copy = copyOf(userMine);
    expect(isCamData({ setups: [{ id: "s1", post: copy }], tools: [] })).toBe(
      true,
    );
    for (const post of [
      { ...copy, words: "G0" },
      { ...copy, script: "x" },
      { id: "user.s", libraryRef: { id: "" } },
    ])
      expect(isCamData({ setups: [{ id: "s1", post }], tools: [] })).toBe(
        false,
      );
  });
});
