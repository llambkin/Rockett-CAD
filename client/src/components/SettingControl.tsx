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
  const choices = schema.enum?.filter(
    (item): item is string => typeof item === "string",
  );
  if (choices)
    return (
      <SelectField
        label={definition.label}
        value={String(value)}
        options={choices.map((choice) => [choice, choice])}
        onChange={onChange}
      />
    );
  if (schema.type === "boolean")
    return (
      <CheckField
        label={definition.label}
        value={Boolean(value)}
        onChange={onChange}
      />
    );
  if (schema.type === "number" || schema.type === "integer")
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
  if (schema.type === "array" && schema.items?.type === "number")
    return (
      <NumberListField
        label={definition.label}
        value={value}
        onChange={onChange}
      />
    );
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
