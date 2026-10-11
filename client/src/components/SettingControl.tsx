import { useEffect, useState } from "react";
import { APPEARANCE_ACCENT, type SettingDefinition } from "@rockett/shared";
import { AccentPicker } from "./AccentPicker";
import { CheckField, NumField, SelectField } from "./form/fields";
import { evaluateField, parameterValues } from "./form/expressionField";
import { useStore } from "../store";

export type FieldSchema = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: { type?: string };
};

export function fieldKind(schema: FieldSchema) {
  if (schema.enum) return "select";
  if (schema.type === "boolean") return "check";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "array" && schema.items?.type === "number")
    return "numberList";
  if (schema.type === "string") return "text";
  return undefined;
}

export function numberInputError(
  schema: FieldSchema,
  target: EventTarget,
): string | null {
  if (!(target instanceof HTMLInputElement) || target.inputMode !== "decimal")
    return null;
  const spec = {
    dimension: "unitless" as const,
    int: schema.type === "integer",
    min: schema.minimum,
    max: schema.maximum,
  };
  const values = parameterValues(useStore.getState().document);
  if (!("error" in evaluateField(target.value, spec, values))) return null;
  return `Enter a number from ${schema.minimum ?? "-∞"} to ${schema.maximum ?? "∞"}.`;
}

function NumberListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const shown = Array.isArray(value) ? value.join(", ") : "";
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(null), [shown]);
  const commit = () => {
    if (text !== null)
      onChange(
        text
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
      );
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={text ?? shown}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}

export function FieldControl({
  definition,
  value,
  schema,
  onChange,
}: {
  definition: SettingDefinition;
  value: unknown;
  schema: FieldSchema;
  onChange: (value: unknown) => void;
}) {
  if (definition.key === APPEARANCE_ACCENT.key)
    return (
      <AccentPicker
        label={definition.label}
        value={String(value)}
        onChange={onChange}
      />
    );
  const kind = fieldKind(schema);
  if (kind === "select")
    return (
      <SelectField
        label={definition.label}
        value={String(value)}
        options={(schema.enum ?? [])
          .filter((item): item is string => typeof item === "string")
          .map((choice) => [choice, definition.labels?.[choice] ?? choice])}
        onChange={onChange}
      />
    );
  if (kind === "check")
    return (
      <CheckField
        label={definition.label}
        value={Boolean(value)}
        onChange={onChange}
      />
    );
  if (kind === "number")
    return (
      <NumField
        label={definition.label}
        value={Number(value)}
        onChange={onChange}
        min={schema.minimum}
        max={schema.maximum}
        int={schema.type === "integer"}
      />
    );
  if (kind === "numberList")
    return (
      <NumberListField
        label={definition.label}
        value={value}
        onChange={onChange}
      />
    );
  if (kind !== "text") return null;
  return (
    <label className="field">
      <span>{definition.label}</span>
      {schema.pattern?.includes("#") && (
        <input
          type="color"
          value={String(value)}
          aria-label={`${definition.label} swatch`}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <input
        type="text"
        value={String(value)}
        aria-label={definition.label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
