import { useEffect, useState } from "react";

export function NumField({
  label,
  value,
  onChange,
  int,
  min,
  max,
  step,
  ariaLabel,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  int?: boolean;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(Number.isFinite(value) ? String(value) : "");
  }, [value, focused]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? (int ? 1 : "any")}
        aria-label={ariaLabel}
        value={focused ? text : Number.isFinite(value) ? String(value) : ""}
        onFocus={() => {
          setText(Number.isFinite(value) ? String(value) : "");
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (
            e.target.value.trim() !== "" &&
            Number.isFinite(v) &&
            (min === undefined || v >= min) &&
            (max === undefined || v <= max)
          )
            onChange(v);
        }}
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AxisField({
  axisSource,
  axis,
  onChange,
}: {
  axisSource: unknown;
  axis: string | undefined;
  onChange: (
    patch: { axisSource: "edge" } | { axisSource: "origin"; axis: string },
  ) => void;
}) {
  return (
    <SelectField
      label="Axis"
      value={axisSource === "edge" ? "edge" : (axis ?? "Z")}
      options={[
        ["X", "X axis"],
        ["Y", "Y axis"],
        ["Z", "Z axis"],
        ["edge", "Selected line/edge"],
      ]}
      onChange={(v) =>
        onChange(
          v === "edge"
            ? { axisSource: "edge" }
            : { axisSource: "origin", axis: v },
        )
      }
    />
  );
}

export function CheckField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field check">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function SelInfo({
  label,
  count,
  hint,
}: {
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <div className={`sel-info ${count > 0 ? "have" : ""}`}>
      <span>{label}</span>
      <b>{count > 0 ? `${count} selected` : hint}</b>
    </div>
  );
}
