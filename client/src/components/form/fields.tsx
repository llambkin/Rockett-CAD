import {
  fromMm,
  toMm,
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
      autoFocus={autoFocus}
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

function numbered(kind: string, index: number, owner?: string): string {
  const name = index >= 0 ? `${kind} ${index + 1}` : kind;
  return owner ? `${name}, ${owner}` : name;
}

function pickLabel(
  pick: Selection,
  document: CadDocument | null,
  evaluation: EvaluateResult | null,
  bodies: BodyPayload[],
): string {
  const featureName = (id: string) =>
    document?.features.find((f) => f.id === id)?.name;
  if (pick.kind === "plane") {
    const ref = pick.ref;
    if (ref.kind === "origin") return `${ref.plane} Plane`;
    if (ref.kind === "construction")
      return featureName(ref.featureId) ?? "Plane";
    return pickLabel(ref.face, document, evaluation, bodies);
  }
  if ("bodyId" in pick) {
    const body = bodies.find((b) => b.bodyId === pick.bodyId);
    if (pick.kind === "body") return body?.name ?? "Body";
    const [kind, list, name] =
      pick.kind === "face"
        ? ["Face", body?.faces, pick.faceName]
        : pick.kind === "edge"
          ? ["Edge", body?.edges, pick.edgeName]
          : ["Vertex", body?.vertices, pick.vertexName];
    return numbered(
      kind,
      list?.findIndex((x) => x.name === name) ?? -1,
      body?.name,
    );
  }
  const sketch = featureName(pick.sketchId);
  if (pick.kind === "sketch") return sketch ?? "Sketch";
  if (pick.kind === "profile") {
    const profiles = evaluation?.sketches.find(
      (s) => s.featureId === pick.sketchId,
    )?.profiles;
    return numbered(
      "Profile",
      profiles?.findIndex((x) => x.id === pick.profileId) ?? -1,
      sketch,
    );
  }
  const entities =
    (document?.features.find((f) => f.id === pick.sketchId) as SketchFeature)
      ?.entities ?? [];
  const entity = entities.find((e) => e.id === pick.entityId);
  if (!entity) return numbered("Entity", -1, sketch);
  const same = entities.filter((e) => e.kind === entity.kind);
  return numbered(
    entity.kind[0]!.toUpperCase() + entity.kind.slice(1),
    same.indexOf(entity),
    sketch,
  );
}

export function SelInfo({
  label,
  picks,
  hint,
}: {
  label: string;
  picks: Selection[];
  hint: string;
}) {
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const mode = useStore((s) => s.mode);
  const bodies = previewBodies({ mode, evaluation });
  const setHover = useStore((s) => s.setHover);
  const hovered = useRef<Selection | null>(null);
  const hover = (pick: Selection | null) => {
    hovered.current = pick;
    setHover(pick);
  };
  useEffect(
    () => () => {
      const s = useStore.getState();
      if (hovered.current && s.hover === hovered.current) s.setHover(null);
    },
    [],
  );
  const remove = (gone: Selection[]) => {
    const keys = new Set(gone.map(selectionKey));
    const s = useStore.getState();
    s.setSelection(s.selection.filter((x) => !keys.has(selectionKey(x))));
    setHover(null);
  };
  return (
    <>
      <div className={`sel-info ${picks.length > 0 ? "have" : ""}`}>
        <span>{label}</span>
        <b>{picks.length > 0 ? `${picks.length} selected` : hint}</b>
      </div>
      {picks.length > 0 && (
        <div role="list" aria-label={label}>
          {picks.map((pick) => {
            const name = pickLabel(pick, document, evaluation, bodies);
            return (
              <div
                key={selectionKey(pick)}
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
                  onClick={() => remove([pick])}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button className="btn" onClick={() => remove(picks)}>
            Clear
          </button>
        </div>
      )}
    </>
  );
}
