import {
  autoTarget,
  ORIGIN_AXES,
  type Units,
  type OriginAxis,
  type ExtrudeFeature,
} from "@rockett/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectionKey, useStore, type Selection } from "../../store";
import { previewBodies, usePreviewBase } from "../../previewBase";
import {
  activeInput,
  featureParams,
  setFeatureParams,
  clearInput,
  readInput,
} from "../../commands/featureCommand";
import { chosenTargets, several, storedAuto } from "../../toolTargets";
import { pickLabel } from "../../selection/labels";
export { pickLabel } from "../../selection/labels";
import { ExpressionField, type ExpressionFieldProps } from "./expressionField";

type NumericProps = Omit<ExpressionFieldProps, "dimension" | "units">;

export function NumField(props: NumericProps) {
  return <ExpressionField {...props} dimension="unitless" />;
}

export function LengthField({
  label,
  units,
  ...props
}: NumericProps & { label: string; units: Units }) {
  return (
    <ExpressionField
      {...props}
      label={`${label} (${units})`}
      dimension="length"
      units={units}
    />
  );
}

export function AngleField({
  label,
  ...props
}: NumericProps & { label: string }) {
  return (
    <ExpressionField {...props} label={`${label} (°)`} dimension="angle" />
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: NoInfer<T>) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const selected = options.find(([v]) => v === e.target.value);
          if (selected) onChange(selected[0]);
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const axisOptions = ORIGIN_AXES.map((a): [OriginAxis, string] => [
  a,
  `${a} axis`,
]);

export function AxisField({
  axisSource,
  axis,
  onChange,
  label = "Axis",
  defaultAxis = "Z",
  edgeLabel = "Selected line/edge",
}: {
  axisSource: unknown;
  axis: OriginAxis | undefined;
  onChange: (
    patch: { axisSource: "edge" } | { axisSource: "origin"; axis: OriginAxis },
  ) => void;
  label?: string;
  defaultAxis?: OriginAxis;
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

function Labelled({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <>
      <label className="field">
        <span>{label}</span>
        {children}
      </label>
      {error && (
        <span className="field-hint" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

export function TextField({
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  error?: string | null;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Labelled label={label} error={error}>
      <input
        type="text"
        aria-invalid={!!error}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Labelled>
  );
}

export function TextAreaField({
  label,
  value,
  maxLength,
  rows = 3,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  rows?: number;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const [cutTo, setCutTo] = useState<string | null>(null);
  const composing = useRef<string | null>(null);
  const change = (area: HTMLTextAreaElement, before: string) => {
    const next = area.value;
    const size = Array.from(next).length;
    const drop = Math.min(size - maxLength, size - Array.from(before).length);
    if (drop <= 0) {
      setCutTo(null);
      onChange(next);
      return;
    }
    const end = area.selectionEnd;
    const head = Array.from(next.slice(0, end));
    const keep = head.slice(0, head.length - drop).join("");
    const kept = keep + next.slice(end);
    area.value = kept;
    area.setSelectionRange(keep.length, keep.length);
    setCutTo(kept);
    onChange(kept);
  };
  const error =
    cutTo === value ? `Cut to the ${maxLength} character limit` : null;
  return (
    <Labelled label={label} error={error}>
      <textarea
        rows={rows}
        value={value}
        disabled={disabled}
        onCompositionStart={() => {
          composing.current = value;
        }}
        onCompositionEnd={(e) => {
          const before = composing.current ?? value;
          composing.current = null;
          change(e.currentTarget, before);
        }}
        onChange={(e) =>
          composing.current === null
            ? change(e.target, value)
            : onChange(e.target.value)
        }
      />
    </Labelled>
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
    useShallow((s) => ({
      document: s.document,
      evaluation: s.evaluation,
      command: s.active,
      selection: s.selection,
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

const body = (bodyId: string): Selection => ({ kind: "body", bodyId });

export function TargetField({ operation }: { operation: string }) {
  const value: string[] | undefined = useStore((s) => featureParams(s).targets);
  const featureId = useStore((s) => featureParams(s).id);
  const setParams = setFeatureParams;
  const namingVersion = useStore((s) => s.document?.namingVersion);
  const evaluation = useStore((s) => s.evaluation);
  const active = useStore((s) => s.active);
  const hidden = useStore((s) => s.view.hidden.bodies);
  const document = useStore((s) => s.document);
  if (operation === "newBody") return null;
  const bodies = previewBodies({ active, evaluation });
  const many = several(operation, namingVersion);
  const ids = chosenTargets(operation, value, namingVersion);
  const set = (next: string[]) =>
    setParams({ targets: next.length > 0 ? next : undefined });
  const auto = ids.length === 0 && storedAuto(document, featureId);
  const autoIds =
    auto &&
    bodies.flatMap((b) => (autoTarget(auto, b.bodyId) ? [b.bodyId] : []));
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
      <SelInfo
        label={label}
        input="targets"
        hint="Auto, or click a body"
        {...(autoIds && {
          picks: autoIds.map(body),
          onRemove: (keys) =>
            set(autoIds.filter((id) => !keys.includes(selectionKey(body(id))))),
        })}
      />
    </>
  );
}

export function OperationField({ intersect }: { intersect?: boolean }) {
  const operation = useStore((s) => featureParams(s).operation ?? "join");
  const setParams = setFeatureParams;
  return (
    <>
      <SelectField<NonNullable<ExtrudeFeature["operation"]>>
        label="Operation"
        value={operation}
        options={[
          ["newBody", "New body"],
          ["join", "Join"],
          ["cut", "Cut"],
          ...(intersect
            ? ([["intersect", "Intersect"]] satisfies [
                NonNullable<ExtrudeFeature["operation"]>,
                string,
              ][])
            : []),
        ]}
        onChange={(v) => setParams({ operation: v, autoOperation: false })}
      />
      <TargetField operation={operation} />
    </>
  );
}
