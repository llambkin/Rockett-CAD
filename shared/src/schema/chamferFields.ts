import { Type, type TSchema } from "typebox";
import type { ChamferType, Feature, FilletType } from "../model.js";

const BLEND_FIELDS = ["distance2", "endRadius", "angle", "flip"] as const;
type BlendField = (typeof BLEND_FIELDS)[number];
type BlendKind = "fillet" | "chamfer";
type Typed = Partial<Record<BlendField | `${BlendKind}Type` | "sets", unknown>>;

const TYPE_FIELDS: {
  fillet: Record<FilletType, readonly BlendField[]>;
  chamfer: Record<ChamferType, readonly BlendField[]>;
} = {
  fillet: {
    equalDistance: [],
    twoDistances: ["distance2", "flip"],
    variableRadius: ["endRadius"],
  },
  chamfer: {
    equalDistance: [],
    twoDistances: ["distance2", "flip"],
    distanceAngle: ["angle", "flip"],
  },
};

const OWNED: Record<BlendKind, string> = {
  fillet:
    "needs a second distance and a flip exactly for two distances, an end radius exactly for a variable radius, and several sets only for equal distance",
  chamfer:
    "needs a second distance and a flip exactly for two distances, and an angle and a flip exactly for distance and angle",
};

function blendOwns(kind: BlendKind, f: Typed, field: BlendField) {
  const fields: Record<string, readonly BlendField[]> = TYPE_FIELDS[kind];
  const type = String(f[`${kind}Type`]);
  return Object.hasOwn(fields, type) && fields[type]!.includes(field);
}

function ownsExactly(kind: BlendKind) {
  return (f: Typed) =>
    BLEND_FIELDS.every(
      (key) => blendOwns(kind, f, key) === (f[key] !== undefined),
    ) &&
    (!Array.isArray(f.sets) ||
      f.sets.length === 0 ||
      f[`${kind}Type`] === "equalDistance");
}

export const ownedFields = <T extends TSchema>(kind: BlendKind, schema: T) =>
  Type.Refine<T, Typed>(schema, ownsExactly(kind), () => OWNED[kind]);

export function dropUnownedBlendFields(feature: Feature, patch: object) {
  if (feature.type !== "fillet" && feature.type !== "chamfer") return;
  if (!(`${feature.type}Type` in patch)) return;
  for (const key of BLEND_FIELDS)
    if (!(key in patch) && !blendOwns(feature.type, feature, key))
      Reflect.deleteProperty(feature, key);
}
