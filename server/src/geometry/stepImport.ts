import { NAME_LENGTH, type ImportNode } from "@rockett/shared";
import { solids, type Shape } from "./kernel.js";
import type { BodyPiece } from "./naming.js";
import { readXdeStep, type XdeNode } from "./xde.js";
import {
  registerPieces,
  type EvalState,
  type FeatureOutcome,
  type ImportedLabel,
} from "./featureState.js";

const DEFAULT_NAME = /^Open CASCADE STEP translator \d+(\.\d+)* \d+$/;

type ImportedSolid = {
  shape: Shape;
  label?: ImportedLabel;
  body?: number;
};

export type Solids = { shape: Shape; parts: ImportedSolid[]; tree?: XdeNode[] };

function cleanName(raw: string | null | undefined): string | undefined {
  const name = raw?.replace(/\p{Cc}/gu, "").trim();
  if (!name || DEFAULT_NAME.test(name)) return undefined;
  return name.slice(0, NAME_LENGTH);
}

export function readStep(
  data: Uint8Array,
): { shapes: Shape[]; parts: ImportedSolid[]; tree: XdeNode[] } | undefined {
  let read;
  try {
    read = readXdeStep(data);
  } catch (error) {
    if ((error as Error).message === "STEP file could not be read") return;
    throw error;
  }
  const parts = read.bodies.flatMap(({ name, path, color, shape }, body) => {
    const text = cleanName(path.at(-1)) ?? cleanName(name);
    const label = { ...(text && { name: text }), ...(color && { color }) };
    return solids(shape).map((solid) => ({ shape: solid, label, body }));
  });
  return { shapes: read.bodies.map((b) => b.shape), parts, tree: read.tree };
}

function importTree(
  tree: XdeNode[],
  placed: Array<[string, ImportedSolid]>,
): ImportNode[] {
  const ids = new Map<number, string[]>();
  for (const [id, { body }] of placed)
    if (body !== undefined) ids.set(body, [...(ids.get(body) ?? []), id]);
  const node = (xde: XdeNode, path: number[]): ImportNode => {
    const name = cleanName(xde.name);
    return {
      ...(name && { name }),
      path,
      bodyIds: "body" in xde ? (ids.get(xde.body) ?? []) : [],
      children:
        "children" in xde
          ? xde.children.map((child, i) => node(child, [...path, i]))
          : [],
    };
  };
  return tree.map((root, i) => node(root, [i]));
}

export function placeImport(
  state: EvalState,
  bodyId: string,
  { parts, tree }: Solids,
  names: BodyPiece["names"],
): FeatureOutcome | void {
  const pieces = parts.map((part) => ({ ...part, names }));
  const placed = registerPieces(state, bodyId, pieces);
  for (const [id, { label }] of placed)
    if (label) state.imported.set(id, label);
  if (tree) return { importTree: importTree(tree, placed) };
}
