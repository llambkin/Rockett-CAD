import { useLayoutEffect, useRef, useState } from "react";
import {
  toMm,
  type DimensionConstraint,
  type SketchConstraint,
  type Units,
} from "@rockett/shared";
import { useStore } from "../store";
import * as tools from "../sketchTools";
import { storedExpression } from "../features/bindings";
import { confirm } from "./ConfirmPanel";
import { ExpressionField } from "./form/expressionField";

export interface DimEditField {
  constraintId: string;
  value: string;
  label?: string;
  unit?: Units | "°" | "";
}

export interface DimEdit {
  fields: DimEditField[];
  x: number;
  y: number;
}

interface Entry extends DimEditField {
  number: number;
  stored: string | undefined;
  link: string | null | undefined;
  invalid: boolean;
  text: string;
}

function linkedText(constraintId: string): string | undefined {
  const { document, draftSketch } = useStore.getState();
  const saved = document?.features.find((f) => f.id === draftSketch?.id);
  if (saved?.type !== "sketch") return undefined;
  const at = saved.constraints.findIndex((c) => c.id === constraintId);
  return at < 0
    ? undefined
    : storedExpression(document, saved.id, `/constraints/${at}/value`);
}

function entry(field: DimEditField, units: Units): Entry {
  const stored = linkedText(field.constraintId);
  const drafted = useStore
    .getState()
    .draftSketch?.constraints.find((c) => c.id === field.constraintId);
  const shown = Number(field.value);
  const number =
    stored !== undefined && drafted && "value" in drafted
      ? drafted.value
      : field.unit === "°"
        ? shown
        : toMm(shown, field.unit || units);
  return {
    ...field,
    number,
    stored,
    link: undefined,
    invalid: false,
    text: stored ?? field.value,
  };
}

function edited(fields: Entry[], draft: SketchConstraint[]) {
  let constraints = draft;
  const links: Record<string, string | null> = {};
  for (const f of fields) {
    const found = constraints.find((c) => c.id === f.constraintId);
    const v = found ? tools.dimensionValue(found, String(f.number)) : null;
    if (v === null) continue;
    if (f.link !== undefined) links[f.constraintId] = f.link;
    constraints = tools.dedupeDimensions(
      constraints.map((c) => {
        if (c.id !== f.constraintId) return c;
        const { driven: _driven, ...driving } = {
          ...(c as DimensionConstraint),
          value: v,
        };
        return driving;
      }) as SketchConstraint[],
      f.constraintId,
    );
  }
  return { constraints, links };
}

export async function updateOfferingDriven(constraints: SketchConstraint[]) {
  const s = useStore.getState();
  const entities = s.draftSketch?.entities;
  if (!entities) return null;
  let first: SketchConstraint | null = null;
  let next = constraints;
  for (let left = constraints.length; left >= 0; left--) {
    const refused = s.updateDraftSketch(entities, next);
    first ??= refused;
    if (
      !refused ||
      !("value" in refused) ||
      !(await confirm(
        `${useStore.getState().error} Add it as a driven dimension instead?`,
      ))
    )
      return first;
    useStore.setState({ error: null });
    next = next.map((c) =>
      c.id === refused.id ? { ...refused, driven: true } : c,
    );
  }
  return first;
}

async function commitFields(fields: Entry[]) {
  const s = useStore.getState();
  const draft = s.draftSketch;
  if (!draft) return;
  const { constraints, links } = edited(fields, draft.constraints);
  if (constraints === draft.constraints) return;
  await updateOfferingDriven(constraints);
  await s.commitDraftSketch(links);
}

async function removeDimensions(ids: string[]) {
  const s = useStore.getState();
  const draft = s.draftSketch;
  if (!draft) return;
  s.updateDraftSketch(
    draft.entities,
    draft.constraints.filter((c) => !ids.includes(c.id)),
  );
  await s.commitDraftSketch();
}

const indexOf = (root: HTMLElement, target: EventTarget) =>
  [...root.querySelectorAll("input")].indexOf(target as HTMLInputElement);

function DimInput({
  field: f,
  units,
  update,
}: {
  field: Entry;
  units: Units;
  update: (change: Partial<Entry>) => void;
}) {
  return (
    <>
      {f.label && <span className="dim-key">{f.label}</span>}
      <ExpressionField
        ariaLabel={f.label ? `Dimension ${f.label}` : "Dimension value"}
        dimension={f.unit === "°" ? "angle" : "length"}
        units={f.unit === "°" ? undefined : f.unit || units}
        above={f.unit === "°" ? undefined : 0}
        value={f.number}
        onChange={(number) => update({ number })}
        onClear={() => update({ text: "" })}
        bind={{
          text: f.link === undefined ? f.stored : (f.link ?? undefined),
          set: (link) =>
            update(
              link === false ? { invalid: true } : { link, invalid: false },
            ),
        }}
      />
      {f.unit && !/[a-z]$/i.test(f.text.trim()) && (
        <span className="dim-unit">{f.unit}</span>
      )}
    </>
  );
}

function useFocusFirst() {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const first = box.current?.querySelector("input");
    first?.focus();
    first?.select();
  }, []);
  return box;
}

export function DimensionEdit({
  edit,
  units,
  onClose,
}: {
  edit: DimEdit;
  units: Units;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(() =>
    edit.fields.map((f) => entry(f, units)),
  );
  const committing = useRef(false);
  const box = useFocusFirst();
  const update = (i: number, change: Partial<Entry>) =>
    setFields((all) => all.map((f, j) => (j === i ? { ...f, ...change } : f)));

  async function commit() {
    if (committing.current) return;
    if (fields.some((f) => f.invalid || !f.text.trim())) return;
    committing.current = true;
    try {
      await commitFields(fields);
    } finally {
      committing.current = false;
    }
    onClose();
  }

  async function remove(ids: string[]) {
    await removeDimensions(ids);
    onClose();
  }

  return (
    <div
      ref={box}
      className="dim-edit"
      style={{ left: edit.x, top: edit.y }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          void commit();
      }}
      onChange={(e) => {
        const i = indexOf(e.currentTarget, e.target);
        if (i >= 0) update(i, { text: (e.target as HTMLInputElement).value });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Return") void commit();
        if (e.key === "Escape") onClose();
        const i = indexOf(e.currentTarget, e.target);
        if (
          (e.key === "Delete" || e.key === "Backspace") &&
          fields[i]?.text === ""
        ) {
          e.preventDefault();
          void remove([fields[i]!.constraintId]);
        }
      }}
    >
      {fields.map((f, i) => (
        <DimInput
          key={f.constraintId}
          field={f}
          units={units}
          update={(change) => update(i, change)}
        />
      ))}
      <button
        className="dim-edit-delete"
        title="Delete this dimension"
        aria-label="Delete dimension"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void remove(fields.map((f) => f.constraintId))}
      >
        ✕
      </button>
    </div>
  );
}
