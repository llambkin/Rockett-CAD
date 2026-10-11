import type { Tool } from "./tools.js";

export const OPERATION_VERSIONS = {
  "rockett.cam.facing": 1,
  "rockett.cam.contour": 1,
  "rockett.cam.pocket": 1,
  "rockett.cam.adaptive": 1,
  "rockett.cam.drill": 1,
  "rockett.cam.parallel": 1,
  "rockett.cam.waterline": 1,
  "rockett.cam.laser": 1,
} as const satisfies Record<string, number>;

export type OperationType = keyof typeof OPERATION_VERSIONS;

export const isOperation = (type: string): type is OperationType =>
  Object.hasOwn(OPERATION_VERSIONS, type);

type Kinds = readonly Tool["kind"][];

const OPERATION_TOOLS: Readonly<
  Record<OperationType, Kinds> & Record<string, Kinds>
> = {
  "rockett.cam.facing": ["flat", "bull"],
  "rockett.cam.contour": ["flat", "bull"],
  "rockett.cam.pocket": ["flat", "bull"],
  "rockett.cam.adaptive": ["flat", "bull"],
  "rockett.cam.drill": ["drill"],
  "rockett.cam.parallel": ["ball"],
  "rockett.cam.waterline": ["flat", "ball", "bull"],
  "rockett.cam.laser": ["flat"],
};

const listed = (kinds: Kinds) =>
  kinds.length > 1
    ? `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`
    : kinds.join("");

export function toolRefusal(
  type: string,
  kind?: Tool["kind"],
): string | undefined {
  const kinds = Object.hasOwn(OPERATION_TOOLS, type)
    ? OPERATION_TOOLS[type]
    : undefined;
  if (!kinds) return `operation ${type} is not supported`;
  if (kind === undefined || kinds.includes(kind)) return undefined;
  const name = type.slice(type.lastIndexOf(".") + 1);
  return `${name} needs a ${listed(kinds)} end mill, not a ${kind}`;
}
