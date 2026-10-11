import { Type } from "typebox";
import fluidnc from "../../posts/fluidnc.json";
import grbl from "../../posts/grbl.json";
import grblhal from "../../posts/grblhal.json";
import linuxcnc from "../../posts/linuxcnc.json";
import mach from "../../posts/mach.json";
import marlin from "../../posts/marlin.json";
import { importPostProblems, type Post } from "../post/schema.js";
import {
  sizeProblem,
  storedPostProblem,
  USER_POST_PREFIX,
} from "../shared/document.js";

function shipped(value: unknown): Post {
  const problems = importPostProblems(value);
  if (problems.length) throw new Error(problems.join("\n"));
  return value as Post;
}

export const POSTS: ReadonlyMap<string, Post> = new Map(
  [fluidnc, grbl, grblhal, linuxcnc, mach, marlin]
    .map(shipped)
    .map((post) => [post.id, post]),
);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function userPostProblem(text: string): string {
  const size = sizeProblem(text);
  if (size) return size;
  const value = parsed(text);
  if (value === undefined) return "is not JSON";
  return (
    importPostProblems(value)[0] ?? storedPostProblem(userPost(value as Post))
  );
}

export function userPost(post: Post): Post {
  return post.id.startsWith(USER_POST_PREFIX)
    ? post
    : { ...post, id: `${USER_POST_PREFIX}${post.id}` };
}

export const userPostText = Type.Refine(
  Type.String(),
  (text) => !userPostProblem(text),
  userPostProblem,
);
