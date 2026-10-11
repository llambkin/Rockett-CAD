import { createElement as h, type ReactNode } from "react";
import { Type, type TObject, type TSchema, type TSchemaOptions } from "typebox";
import type {
  ClientContext,
  FaceRef,
  NumberFieldProps,
} from "@rockett/plugin-api";

type Meta = TSchemaOptions & {
  parameterUnit?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  const?: string;
};

type Bounds = Pick<NumberFieldProps, "min" | "max" | "above" | "int">;

const meta = (schema: TSchema) => schema as TSchema & Meta;

function bounds(schema: TSchema): Bounds {
  const { minimum, maximum, exclusiveMinimum } = meta(schema);
  const out: Bounds = {};
  if (minimum !== undefined) out.min = minimum;
  if (maximum !== undefined) out.max = maximum;
  if (exclusiveMinimum !== undefined) out.above = exclusiveMinimum;
  if (Type.IsInteger(schema)) out.int = true;
  return out;
}

const choices = (schema: TSchema): [string, string][] | null =>
  Type.IsUnion(schema) &&
  schema.anyOf.every((c) => Type.IsLiteral(c) && typeof c.const === "string")
    ? schema.anyOf.map((c) => [meta(c).const!, meta(c).title ?? meta(c).const!])
    : null;

const isFace = (schema: TSchema) =>
  Type.IsObject(schema) &&
  (schema.properties["kind"] as Meta | undefined)?.const === "face";

export const firstChoices = (schema: TObject): Record<string, string> =>
  Object.fromEntries(
    Object.entries(schema.properties).flatMap(([key, field]) => {
      const [first] = choices(field) ?? [];
      return first ? [[key, first[0]]] : [];
    }),
  );

export const faceKeys = (schema: TObject) =>
  Object.keys(schema.properties).filter((key) =>
    isFace(schema.properties[key]!),
  );

export function schemaFields<T extends Record<string, unknown>>(
  ui: ClientContext["ui"],
  schema: TObject,
  value: T,
  edit: (value: T) => void,
  faceLabel?: (ref: FaceRef) => string,
): ReactNode[] {
  return Object.entries(schema.properties).flatMap(([key, field]) => {
    const label = meta(field).title;
    if (label === undefined) return [];
    const onChange = (next: unknown) => edit({ ...value, [key]: next });
    if (faceLabel && isFace(field)) {
      const ref = value[key] as FaceRef | undefined;
      return h(ui.TextField, {
        key,
        label,
        value: ref ? faceLabel(ref) : "",
        onChange: () => undefined,
        disabled: true,
      });
    }
    const options = choices(field);
    if (options)
      return h(ui.SelectField<string>, {
        key,
        label,
        value: value[key] as string,
        options,
        onChange,
      });
    if (Type.IsBoolean(field))
      return h(ui.CheckField, {
        key,
        label,
        value: value[key] === true,
        onChange,
      });
    if (Type.IsNumber(field) || Type.IsInteger(field)) {
      const props = {
        key,
        label,
        value: value[key] as number,
        onChange,
        ...(Type.IsOptional(field) && {
          onClear: () => edit({ ...value, [key]: undefined }),
        }),
        ...bounds(field),
      };
      const unit = meta(field).parameterUnit;
      if (unit === "mm") return h(ui.LengthField, props);
      if (unit === "deg") return h(ui.AngleField, props);
      return h(ui.NumField, props);
    }
    throw new Error(`${key} has no form field for its schema`);
  });
}
