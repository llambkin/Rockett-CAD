import { Placement } from "@rockett/plugin-api";
import { MODEL_NAME_LENGTH, type Footprint, type Model } from "./data.js";

export const MODEL_ROOTS: readonly string[] = [
  "KICAD9_3DMODEL_DIR",
  "KICAD10_3DMODEL_DIR",
  "KIPRJMOD",
];
export const MODEL_GAP = 0.05;

const DEGREES = Math.PI / 180;

export function modelName(path: string): string {
  if (path.length > MODEL_NAME_LENGTH || /\p{Cc}/u.test(path))
    throw new Error("Model path is too long or has control characters");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path))
    throw new Error("Model path is a URL; network fetches are refused");
  const rooted = /^\$\{([^}]*)\}\/(.*)$/su.exec(path);
  if (!rooted)
    throw new Error(
      `Model path must start with ${MODEL_ROOTS.map((root) => `\${${root}}`).join(", ")}`,
    );
  const [, root = "", rest = ""] = rooted;
  if (!MODEL_ROOTS.includes(root))
    throw new Error(`Model path uses unknown substitution \${${root}}`);
  if (/[$%\\{}]/.test(rest))
    throw new Error("Model path has an escaped or nested substitution");
  if (rest.split("/").some((part) => part === "" || /^\.\.?$/.test(part)))
    throw new Error("Model path leaves its root");
  const name = `\${${root}}/${rest.replace(/\.wrl$/i, ".step")}`;
  if (!/\.(step|stp)$/i.test(name))
    throw new Error("Model path is not a STEP or VRML file");
  return name;
}

export type ModelUse = { path: string } & (
  | { status: "uploaded"; name: string; sha256: string }
  | { status: "missing"; name: string }
  | { status: "refused"; reason: string }
);

export function resolveModel(
  { path, scale }: Model,
  models: Readonly<Record<string, string>> = {},
): ModelUse {
  let name: string;
  try {
    name = modelName(path);
  } catch (error) {
    return { path, status: "refused", reason: (error as Error).message };
  }
  if (!(scale[0] > 0) || scale.some((factor) => factor !== scale[0]))
    return {
      path,
      status: "refused",
      reason: "Model scale must be positive and equal on every axis",
    };
  const sha256 = Object.hasOwn(models, name) ? models[name] : undefined;
  return sha256
    ? { path, status: "uploaded", name, sha256 }
    : { path, status: "missing", name };
}

export function modelPlacement(
  { x, y, angle, side }: Pick<Footprint, "x" | "y" | "angle" | "side">,
  { offset, rotate, scale }: Model,
  thickness: number,
) {
  const turn = (axis: [number, number, number], degrees: number) =>
    Placement.fromAxisAngle(axis, degrees * DEGREES);
  const back = side === "back";
  return {
    placement: [
      Placement.fromTranslation([x, y, 0]),
      turn([0, 0, 1], angle),
      back ? turn([1, 0, 0], 180) : Placement.identity(),
      Placement.fromTranslation([
        offset[0],
        offset[1],
        offset[2] + MODEL_GAP + (back ? 0 : thickness),
      ]),
      turn([0, 0, 1], -rotate[2]),
      turn([0, 1, 0], -rotate[1]),
      turn([1, 0, 0], -rotate[0]),
    ].reduce((outer, inner) => Placement.compose(outer, inner)),
    scale: scale[0],
  };
}
