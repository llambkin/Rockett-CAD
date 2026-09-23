import { fromMm, toMm, type Units } from "@rockett/shared";
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
  className,
  title,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  int?: boolean;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  ariaLabel?: string | undefined;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(Number.isFinite(value) ? String(value) : "");
  }, [value, focused]);
  const input = (
    <input
      type="number"
      className={className}
      title={title}
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
  );
  return label === undefined ? (
    input
  ) : (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  );
}

export function LengthField({
  label,
  value,
  units,
  onChange,
  min,
  max,
  step,
  ariaLabel,
}: {
  label: string;
  value: number;
  units: Units;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
}) {
  const shown = (mm: number | undefined) =>
    mm === undefined ? undefined : fromMm(mm, units);
  return (
    <NumField
      label={`${label} (${units})`}
      value={fromMm(value, units)}
      onChange={(v) => onChange(toMm(v, units))}
      min={shown(min)}
      max={shown(max)}
      step={shown(step)}
      ariaLabel={ariaLabel}
    />
  );
}

export function AngleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (deg: number) => void;
}) {
  return <NumField label={`${label} (°)`} value={value} onChange={onChange} />;
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
