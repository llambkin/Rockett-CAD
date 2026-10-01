import {
  ORIGIN_AXES,
  parseLength,
  roundedLength,
  type Units,
} from "@rockett/shared";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectionKey, useStore, type Selection } from "../../store";
import { previewBodies, usePreviewBase } from "../../previewBase";
import {
  activeInput,
  clearInput,
  readInput,
} from "../../commands/featureCommand";
import { chosenTargets, several } from "../../toolTargets";
import { pickLabel } from "../../selection/labels";
export { pickLabel } from "../../selection/labels";

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
  autoFocus,
  onClear,
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
  autoFocus?: boolean | undefined;
  onClear?: () => void;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setText(Number.isFinite(value) ? String(value) : "");
  }, [value, focused]);
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => window.clearTimeout(t);
  }, []);
  const input = (
    <input
      ref={ref}
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
        if (e.target.value.trim() === "") onClear?.();
        else if (
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
  autoFocus,
}: {
  label: string;
  value: number;
  units: Units;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(String(roundedLength(value, units)));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const parsed = parseLength(text, units);
  const invalid =
    parsed === null ||
    (min !== undefined && parsed < min) ||
    (max !== undefined && parsed > max);
  useEffect(() => {
    if (!focused && !invalid) setText(String(roundedLength(value, units)));
  }, [value, units, focused, invalid]);
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => window.clearTimeout(t);
  }, [autoFocus]);
  return (
    <label className="field">
      <span>{`${label} (${units})`}</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (step === undefined || !["ArrowUp", "ArrowDown"].includes(e.key))
            return;
          e.preventDefault();
          const mm = (parsed ?? value) + step * (e.key === "ArrowUp" ? 1 : -1);
          if (mm < (min ?? -Infinity) || mm > (max ?? Infinity)) return;
          setText(String(roundedLength(mm, units)));
          onChange(mm);
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const mm = parseLength(next, units);
          if (
            mm !== null &&
            (min === undefined || mm >= min) &&
            (max === undefined || mm <= max)
          )
            onChange(mm);
        }}
      />
    </label>
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

const axisOptions = ORIGIN_AXES.map((a): [string, string] => [a, `${a} axis`]);

export function AxisField({
  axisSource,
  axis,
  onChange,
  label = "Axis",
  defaultAxis = "Z",
  edgeLabel = "Selected line/edge",
}: {
  axisSource: unknown;
  axis: string | undefined;
  onChange: (
    patch: { axisSource: "edge" } | { axisSource: "origin"; axis: string },
  ) => void;
  label?: string;
  defaultAxis?: string;
  edgeLabel?: string;
}) {
  return (
    <SelectField
      label={label}
      value={axisSource === "edge" ? "edge" : (axis ?? defaultAxis)}
      options={[...axisOptions, ["edge", edgeLabel]]}
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

export function useHoverPick(): (pick: Selection | null) => void {
  const setHover = useStore((s) => s.setHover);
  const hovered = useRef<Selection | null>(null);
  useEffect(
    () => () => {
      const s = useStore.getState();
      if (hovered.current && s.hover === hovered.current) s.setHover(null);
    },
    [],
  );
  return (pick) => {
    hovered.current = pick;
    setHover(pick);
  };
}

function PickRows({
  label,
  rows,
  onRemove,
}: {
  label: string;
  rows: { key: string; name: string; pick: Selection }[];
  onRemove: (keys: string[]) => void;
}) {
  const hover = useHoverPick();
  const remove = (keys: string[]) => {
    onRemove(keys);
    hover(null);
  };
  if (rows.length === 0) return null;
  return (
    <div role="list" aria-label={label}>
      {rows.map(({ key, name, pick }) => (
        <div
          key={key}
          role="listitem"
          className="measure-row"
          onMouseEnter={() => hover(pick)}
          onMouseLeave={() => hover(null)}
        >
          <span>{name}</span>
          <button
            className="icon-btn danger"
            title="Remove"
            aria-label={`Remove ${name}`}
            onClick={() => remove([key])}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn" onClick={() => remove(rows.map((r) => r.key))}>
        Clear
      </button>
    </div>
  );
}

export function SelInfo({
  label,
  picks,
  hint,
  input,
  onRemove,
}: {
  label: string;
  picks?: Selection[];
  hint: string;
  input: string;
  onRemove?: (keys: string[]) => void;
}) {
  const { document, evaluation, command } = useStore(
    useShallow(({ document, evaluation, active, selection, dialogParams }) => ({
      document,
      evaluation,
      command: active,
      selection,
      dialogParams,
    })),
  );
  const active = useStore((s) => activeInput(s)?.key === input);
  const bodies = previewBodies(
    { active: command, evaluation },
    usePreviewBase(),
  );
  const shown = picks ?? readInput(input, useStore.getState());
  return (
    <>
      <button
        type="button"
        className={`sel-info ${shown.length > 0 ? "have" : ""} ${active ? "selected" : ""}`}
        aria-pressed={active}
        onClick={() => useStore.getState().setPickInput(input)}
      >
        <span>{label}</span>
        <b>{shown.length > 0 ? `${shown.length} selected` : hint}</b>
      </button>
      <PickRows
        label={label}
        rows={shown.map((pick) => ({
          key: selectionKey(pick),
          name: pickLabel(pick, document, evaluation, bodies),
          pick,
        }))}
        onRemove={onRemove ?? ((keys) => clearInput(input, keys))}
      />
    </>
  );
}

export function TargetField({ operation }: { operation: string }) {
  const value: string[] | undefined = useStore((s) => s.dialogParams.targets);
  const setParams = useStore((s) => s.setDialogParams);
  const namingVersion = useStore((s) => s.document?.namingVersion);
  const evaluation = useStore((s) => s.evaluation);
  const active = useStore((s) => s.active);
  const hidden = useStore((s) => s.view.hidden.bodies);
  if (operation === "newBody") return null;
  const bodies = previewBodies({ active, evaluation });
  const many = several(operation, namingVersion);
  const ids = chosenTargets(operation, value, namingVersion);
  const set = (next: string[]) =>
    setParams({ targets: next.length > 0 ? next : undefined });
  const offered = bodies
    .filter(
      (b) => !hidden.includes(b.bodyId) && (!many || !ids.includes(b.bodyId)),
    )
    .map((b): [string, string] => [b.bodyId, b.name]);
  const missing = many
    ? []
    : ids
        .filter((id) => !offered.some(([bodyId]) => bodyId === id))
        .map((id): [string, string] => [
          id,
          bodies.find((b) => b.bodyId === id)?.name ?? id,
        ]);
  const label = many ? "Targets" : "Target";
  return (
    <>
      <SelectField
        label={label}
        value={many ? "" : (ids[0] ?? "")}
        options={[
          ["", many && ids.length > 0 ? "Add body" : "Auto"],
          ...missing,
          ...offered,
        ]}
        onChange={(id) => set(many ? [...ids, id] : id === "" ? [] : [id])}
      />
      <SelInfo label={label} input="targets" hint="Auto, or click a body" />
    </>
  );
}

export function OperationField({ intersect }: { intersect?: boolean }) {
  const operation: string = useStore((s) => s.dialogParams.operation ?? "join");
  const setParams = useStore((s) => s.setDialogParams);
  return (
    <>
      <SelectField
        label="Operation"
        value={operation}
        options={[
          ["newBody", "New body"],
          ["join", "Join"],
          ["cut", "Cut"],
          ...(intersect
            ? [["intersect", "Intersect"] as [string, string]]
            : []),
        ]}
        onChange={(v) => setParams({ operation: v, autoOperation: false })}
      />
      <TargetField operation={operation} />
    </>
  );
}
