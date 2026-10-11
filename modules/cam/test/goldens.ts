import { readFileSync } from "node:fs";
import { formatProgram } from "../src/post/format.js";
import {
  normalise,
  type NormaliseOptions,
  type Units,
} from "../src/post/normalise.js";
import type { Post } from "../src/post/schema.js";
import type { Program } from "../src/shared/ir.js";

export const fixtures = ["facing", "contour", "pocket", "drill"];

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

export const loadPost = (id: string) =>
  JSON.parse(read(`../posts/${id}.json`)) as Post;

export const fixture = (name: string) =>
  JSON.parse(read(`fixtures/ir/${name}.json`)) as Program;

export function format(
  post: Post,
  program: Program,
  units: Units = "mm",
  toolChange?: boolean,
) {
  const options: NormaliseOptions =
    toolChange === undefined ? { units } : { units, toolChange };
  return formatProgram(normalise(program, post, options), post, {});
}

export function golden(post: Post, name: string, count: number) {
  const names =
    count === 1
      ? [name]
      : Array.from({ length: count }, (_, i) => `${name}-${i + 1}`);
  return names.map((each) => read(`golden/${post.id}/${each}.nc`));
}

export function lines(files: string[]) {
  return files.flatMap((file) => file.split("\n").slice(0, -1));
}
