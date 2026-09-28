import {
  ORIGIN_AXES,
  parseLength,
  roundedLength,
  type BodyPayload,
  type CadDocument,
  type EvaluateResult,
  type SketchFeature,
  type Units,
} from "@rockett/shared";
import { useEffect, useRef, useState } from "react";
import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../../store";
import { activeInput, heldBy } from "../../dialogPicks";
import { chosenTargets, several } from "../../toolTargets";

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

function numbered(kind: string, index: number, owner?: string): string {
  const name = index >= 0 ? `${kind} ${index + 1}` : kind;
  return owner ? `${name}, ${owner}` : name;
}

type Ranked<T> = { item: T; rank: number };

const ranks = new WeakMap<readonly object[], Map<string, Ranked<object>>>();

function ranked<T extends object>(
  list: readonly T[],
  id: (x: T) => string,
  group: (x: T) => string = () => "",
): Map<string, Ranked<T>> {
  const hit = ranks.get(list);
  if (hit) return hit as Map<string, Ranked<T>>;
  const counts = new Map<string, number>();
  const made = new Map<string, Ranked<T>>();
  for (const item of list) {
    const key = group(item);
    const rank = counts.get(key) ?? 0;
    counts.set(key, rank + 1);
    if (!made.has(id(item))) made.set(id(item), { item, rank });
  }
  ranks.set(list, made);
  return made;
}

export function pickLabel(
  pick: Selection,
  document: CadDocument | null,
  evaluation: EvaluateResult | null,
  bodies: BodyPayload[],
): string {
  const feature = (id: string) =>
    document && ranked(document.features, (f) => f.id).get(id)?.item;
  const featureName = (id: string) => feature(id)?.name;
  if (pick.kind === "axis") return `${pick.axis} Axis`;
  if (pick.kind === "plane") {
    const ref = pick.ref;
    if (ref.kind === "origin") return `${ref.plane} Plane`;
    if (ref.kind === "construction")
      return featureName(ref.featureId) ?? "Plane";
    return pickLabel(ref.face, document, evaluation, bodies);
  }
  if ("bodyId" in pick) {
    const body = ranked(bodies, (b) => b.bodyId).get(pick.bodyId)?.item;
    if (pick.kind === "body") return body?.name ?? "Body";
    const [kind, list, name]: [
      string,
      readonly { name: string }[] | undefined,
      string,
    ] =
      pick.kind === "face"
        ? ["Face", body?.faces, pick.faceName]
        : pick.kind === "edge"
          ? ["Edge", body?.edges, pick.edgeName]
          : ["Vertex", body?.vertices, pick.vertexName];
    return numbered(
      kind,
      (list && ranked(list, (x) => x.name).get(name)?.rank) ?? -1,
      body?.name,
    );
  }
  const sketch = featureName(pick.sketchId);
  if (pick.kind === "sketch") return sketch ?? "Sketch";
  if (pick.kind === "profile") {
    const profiles =
      evaluation &&
      ranked(evaluation.sketches, (s) => s.featureId).get(pick.sketchId)?.item
        .profiles;
    return numbered(
      "Profile",
      (profiles && ranked(profiles, (x) => x.id).get(pick.profileId)?.rank) ??
        -1,
      sketch,
    );
  }
  const entities = (feature(pick.sketchId) as SketchFeature | undefined)
    ?.entities;
  const entity =
    entities &&
    ranked(
      entities,
      (e) => e.id,
      (e) => e.kind,
    ).get(pick.entityId);
  if (!entity) return numbered("Entity", -1, sketch);
  const { kind } = entity.item;
  return numbered(kind[0]!.toUpperCase() + kind.slice(1), entity.rank, sketch);
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
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const active = useStore((s) => activeInput(s)?.key === input);
  const bodies = previewBodies({ mode, evaluation });
  const shown =
    picks ??
    (mode.name === "dialog" ? heldBy(mode.dialog, input, selection) : []);
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
        onRemove={
          onRemove ??
          ((keys) => {
            const gone = new Set(keys);
            const s = useStore.getState();
            s.setSelection(
              s.selection.filter((x) => !gone.has(selectionKey(x))),
            );
          })
        }
      />
    </>
  );
}

export function TargetField({ operation }: { operation: string }) {
  const value: string[] | undefined = useStore((s) => s.dialogParams.targets);
  const setParams = useStore((s) => s.setDialogParams);
  const namingVersion = useStore((s) => s.document?.namingVersion);
  const evaluation = useStore((s) => s.evaluation);
  const mode = useStore((s) => s.mode);
  const hidden = useStore((s) => s.view.hidden.bodies);
  if (operation === "newBody") return null;
  const bodies = previewBodies({ mode, evaluation });
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
  const picks = ids.map((bodyId): Selection => ({ kind: "body", bodyId }));
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
        picks={picks}
        hint="Auto, or click a body"
        onRemove={(keys) =>
          set(ids.filter((_, i) => !keys.includes(selectionKey(picks[i]!))))
        }
      />
    </>
  );
}

export function OperationField({
  intersect,
  onChange,
}: {
  intersect?: boolean;
  onChange?: (operation: string) => void;
}) {
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
        onChange={onChange ?? ((v) => setParams({ operation: v }))}
      />
      <TargetField operation={operation} />
    </>
  );
}
