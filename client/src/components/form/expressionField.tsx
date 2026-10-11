import {
  evaluateExpression,
  ExpressionError,
  resolveDocumentParameters,
  roundedLength,
  toMm,
  type CadDocument,
  type Scalar,
  type ScalarDimension,
  type Units,
} from "@rockett/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useStore } from "../../store";
import { featureParams, setFeatureParams } from "../../commands/featureCommand";
import { storedExpression } from "../../features/bindings";
import { committedLinks } from "../../previewBase";

type Inputs = Readonly<Record<string, Scalar>>;
const resolved = new WeakMap<object, Inputs>();

export function parameterValues(
  doc: Pick<CadDocument, "parameters"> | null | undefined,
): Inputs {
  if (!doc) return {};
  let values = resolved.get(doc.parameters);
  if (!values) {
    try {
      values = resolveDocumentParameters({
        parameters: doc.parameters,
        parameterBindings: [],
        features: [],
      }).values;
    } catch (error) {
      values = Object.defineProperties(
        {},
        Object.fromEntries(
          doc.parameters.map((p) => [
            p.name,
            {
              enumerable: true,
              get: () => {
                throw error;
              },
            },
          ]),
        ),
      );
    }
    resolved.set(doc.parameters, values);
  }
  return values;
}

export interface FieldSpec {
  dimension: ScalarDimension;
  units?: Units | undefined;
  int?: boolean | undefined;
  min?: number | undefined;
  above?: number | undefined;
  max?: number | undefined;
  below?: number | undefined;
}

export type FieldResult =
  { value: number; linked: string | null } | { error: string };

function shownValue(value: number, spec: FieldSpec): string {
  if (!Number.isFinite(value)) return "";
  return String(
    spec.dimension === "length"
      ? roundedLength(value, spec.units ?? "mm")
      : value,
  );
}

const withUnit = (value: number, spec: FieldSpec) =>
  `${shownValue(value, spec)}${spec.dimension === "length" ? ` ${spec.units ?? "mm"}` : spec.dimension === "angle" ? "°" : ""}`;

const EXPECTED: Record<ScalarDimension, string> = {
  length: "Expected a length",
  angle: "Expected an angle",
  unitless: "Expected a plain number",
};

function evaluated(
  text: string,
  inputs: Inputs,
): { result: Scalar; constant: boolean } {
  try {
    return { result: evaluateExpression(text), constant: true };
  } catch (e) {
    if (!(e instanceof ExpressionError) || e.code !== "name") throw e;
    return { result: evaluateExpression(text, inputs), constant: false };
  }
}

export function evaluateField(
  text: string,
  spec: FieldSpec,
  inputs: Inputs,
): FieldResult {
  if (!text.trim()) return { error: "Enter a value" };
  let found: ReturnType<typeof evaluated>;
  try {
    found = evaluated(text, inputs);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const { result, constant } = found;
  const units = spec.units ?? "mm";
  if (result.dimension !== "unitless" && result.dimension !== spec.dimension)
    return { error: EXPECTED[spec.dimension] };
  const scaled = result.dimension === "unitless" && spec.dimension === "length";
  const value = scaled ? toMm(result.value, units) : result.value;
  if (spec.int && !Number.isInteger(value))
    return { error: "Enter a whole number" };
  if (spec.min !== undefined && value < spec.min)
    return { error: `Must be at least ${withUnit(spec.min, spec)}` };
  if (spec.above !== undefined && value <= spec.above)
    return { error: `Must be more than ${withUnit(spec.above, spec)}` };
  if (spec.max !== undefined && value > spec.max)
    return { error: `Must be at most ${withUnit(spec.max, spec)}` };
  if (spec.below !== undefined && value >= spec.below)
    return { error: `Must be less than ${withUnit(spec.below, spec)}` };
  const linked = constant
    ? null
    : scaled && units !== "mm"
      ? `(${text.trim()}) * 1 ${units}`
      : text.trim();
  return { value, linked };
}

const near = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

type State = ReturnType<typeof useStore.getState>;

export interface FieldLink {
  text: string | undefined;
  set: (expression: string | null | false) => void;
}

type Bind = string | FieldLink | undefined;

export function boundText(s: State, bind: Bind): string | undefined {
  if (typeof bind === "object") return bind.text;
  const path = bind;
  if (path === undefined || s.active?.id !== "design.feature") return undefined;
  const own = featureParams(s).expressions?.[path];
  if (own !== undefined) return own ?? undefined;
  const parameterBindings = s.document ? committedLinks(s.document) : [];
  return storedExpression(
    { parameterBindings },
    s.active.state.editFeatureId,
    path,
  );
}

function mark(bind: string | FieldLink, expression: string | null | false) {
  if (typeof bind === "object") return bind.set(expression);
  const path = bind;
  const { expressions = {}, invalid = [] } = featureParams();
  const others = invalid.filter((p) => p !== path);
  setFeatureParams(
    expression === false
      ? { invalid: [...others, path] }
      : {
          expressions: { ...expressions, [path]: expression },
          invalid: others,
        },
  );
}

function settle(path: Bind) {
  if (typeof path !== "string") return;
  const { invalid = [] } = featureParams();
  if (invalid.includes(path))
    setFeatureParams({ invalid: invalid.filter((p) => p !== path) });
}

export interface ExpressionFieldProps extends FieldSpec {
  label?: string | undefined;
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
  title?: string | undefined;
  autoFocus?: boolean | undefined;
  onClear?: (() => void) | undefined;
  bind?: Bind;
}

export function ExpressionField({
  label,
  value = Number.NaN,
  onChange,
  step,
  ariaLabel,
  className,
  title,
  autoFocus,
  onClear,
  bind,
  ...spec
}: ExpressionFieldProps) {
  const document = useStore((s) => s.document);
  const binding = useStore((s) => boundText(s, bind));
  const inputs = parameterValues(document);
  const display = () => binding ?? shownValue(value, spec);
  const [text, setText] = useState(display);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const cleared = !text.trim() && onClear !== undefined;
  const result = cleared ? null : evaluateField(text, spec, inputs);
  const error = result && "error" in result ? result.error : null;
  useEffect(() => {
    if (!focused && !error) setText(display());
  }, [value, binding, focused, spec.units]);
  useUnlink(bind, value, () =>
    focused || binding === undefined
      ? undefined
      : evaluateField(binding, spec, inputs),
  );
  useAutoFocus(ref, autoFocus);
  const change = (next: string) => {
    setText(next);
    if (!next.trim() && onClear) {
      onClear();
      if (bind !== undefined) mark(bind, null);
      return;
    }
    const r = evaluateField(next, spec, inputs);
    if (bind !== undefined) mark(bind, "error" in r ? false : r.linked);
    if ("value" in r) onChange(r.value);
  };
  const stepBy = step ?? (spec.dimension === "length" ? undefined : 1);
  const input = (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      min={spec.min}
      max={spec.max}
      step={step ?? (spec.int ? 1 : "any")}
      className={className}
      title={error && label === undefined ? error : title}
      aria-label={ariaLabel}
      aria-invalid={error !== null}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        const from = result && "value" in result ? result.value : value;
        const next = stepped(e.key, from, stepBy, spec);
        if (next === undefined) return;
        e.preventDefault();
        if (next !== null) change(shownValue(next, spec));
      }}
      onChange={(e) => change(e.target.value)}
    />
  );
  if (label === undefined) return input;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        {input}
      </label>
      <FieldHint result={result} text={text} spec={spec} />
    </>
  );
}

function FieldHint({
  result,
  text,
  spec,
}: {
  result: FieldResult | null;
  text: string;
  spec: FieldSpec;
}) {
  if (!result) return null;
  if ("error" in result)
    return (
      <span className="field-hint" role="alert">
        {result.error}
      </span>
    );
  if (text.trim() === shownValue(result.value, spec)) return null;
  return <span className="field-hint">= {withUnit(result.value, spec)}</span>;
}

function stepped(
  key: string,
  from: number,
  step: number | undefined,
  spec: FieldSpec,
): number | null | undefined {
  if (step === undefined || (key !== "ArrowUp" && key !== "ArrowDown")) return;
  const next = from + step * (key === "ArrowUp" ? 1 : -1);
  return next < (spec.min ?? -Infinity) || next > (spec.max ?? Infinity)
    ? null
    : next;
}

function useUnlink(
  bind: Bind,
  value: number,
  bound: () => FieldResult | undefined,
) {
  useEffect(() => {
    const result = bind === undefined ? undefined : bound();
    if (result && "value" in result && !near(result.value, value))
      mark(bind!, null);
  }, [value]);
  useEffect(() => () => settle(bind), []);
}

function useAutoFocus(
  ref: RefObject<HTMLInputElement | null>,
  autoFocus: boolean | undefined,
) {
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => window.clearTimeout(t);
  }, [autoFocus]);
}
