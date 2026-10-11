import { useState } from "react";
import {
  ANGLE_TO_DEGREES,
  resolveDocumentParameters,
  UNIT_TO_MM,
  type CadDocument,
  type ParameterUnit,
  type UserParameter,
} from "@rockett/shared";
import { api } from "../api";
import { TextField } from "./form/fields";
import { committedLinks } from "../previewBase";
import { useStore } from "../store";
import { registerPanel, togglePanel } from "../shell/panels";
import { confirm } from "./ConfirmPanel";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { SelectField } from "./form/fields";

export const PARAMETERS_PANEL = "design.parameters";

const UNITS: [ParameterUnit, string][] = [
  ...(Object.keys(UNIT_TO_MM) as ParameterUnit[]),
  "deg" as const,
  "rad" as const,
  "unitless" as const,
].map((unit): [ParameterUnit, string] => [unit, unit]);

const scale = (unit: ParameterUnit) =>
  unit === "unitless"
    ? 1
    : ((UNIT_TO_MM as Record<string, number>)[unit] ??
      (ANGLE_TO_DEGREES as Record<string, number>)[unit] ??
      1);

const resolve = (parameters: UserParameter[]) =>
  resolveDocumentParameters({
    parameters,
    parameterBindings: [],
    features: [],
  }).values;

function failure(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface Checked {
  name: string | null;
  expression: string | null;
  value: string | null;
}

function checkParameters(rows: UserParameter[]): Checked[] {
  const names = rows.map((row, i) =>
    rows.findIndex((other) => other.name === row.name) !== i
      ? "Name is already used"
      : failure(() => resolve([{ ...row, unit: "unitless", expression: "0" }])),
  );
  const named = rows.filter((_, i) => names[i] === null);
  return rows.map((row, i) => {
    if (names[i] !== null)
      return { name: names[i]!, expression: null, value: null };
    let value: string | null = null;
    const expression = failure(() => {
      const scalar = resolve([row, ...named.filter((r) => r !== row)])[
        row.name
      ]!;
      const shown = Math.round((scalar.value / scale(row.unit)) * 1e6) / 1e6;
      value = row.unit === "unitless" ? String(shown) : `${shown} ${row.unit}`;
    });
    return { name: null, expression, value };
  });
}

const blank = (n: number): UserParameter => ({
  name: `p${n}`,
  unit: "mm",
  expression: "0 mm",
  comment: "",
});

function saveParameters(doc: CadDocument, parameters: UserParameter[]) {
  const parameterBindings = committedLinks(doc);
  return useStore
    .getState()
    .mutate((tx) =>
      api.updateParameters(doc.id, { parameters, parameterBindings }, { tx }),
    );
}

function ListState({
  error,
  loading,
  empty,
}: {
  error: string | null;
  loading: boolean;
  empty: boolean;
}) {
  if (error)
    return (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );
  if (loading) return <div className="tree-empty">Loading parameters…</div>;
  if (!empty) return null;
  return (
    <div className="tree-empty">
      No parameters yet. Add one, then type its name in any numeric field.
    </div>
  );
}

function ParameterRow({
  row,
  label,
  checked,
  canEdit,
  onEdit,
  onDelete,
}: {
  row: UserParameter;
  label: string;
  checked: Checked;
  canEdit: boolean;
  onEdit: (patch: Partial<UserParameter>) => void;
  onDelete: (at: { x: number; y: number }) => void;
}) {
  return (
    <div role="listitem" aria-label={label}>
      <TextField
        label="Name"
        value={row.name}
        error={checked.name}
        disabled={!canEdit}
        onChange={(name) => onEdit({ name })}
      />
      <SelectField
        label="Unit"
        value={row.unit}
        options={UNITS}
        onChange={(unit) => onEdit({ unit })}
      />
      <TextField
        label="Expression"
        value={row.expression}
        error={checked.expression}
        disabled={!canEdit}
        onChange={(expression) => onEdit({ expression })}
      />
      <label className="field">
        <span>Value</span>
        <output>{checked.value ?? ""}</output>
      </label>
      <TextField
        label="Comment"
        value={row.comment}
        disabled={!canEdit}
        onChange={(comment) => onEdit({ comment })}
      />
      {canEdit && (
        <button
          className="btn"
          onClick={(e) => onDelete({ x: e.clientX, y: e.clientY })}
        >
          Delete {label}
        </button>
      )}
    </div>
  );
}

export function ParametersPanel({ onClose }: { onClose: () => void }) {
  const document = useStore((s) => s.document);
  const canEdit = useStore((s) => s.access !== "view");
  const [rows, setRows] = useState<UserParameter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const shown = rows ?? document?.parameters ?? [];
  const checked = checkParameters(shown);
  const invalid = checked.some((c) => c.name ?? c.expression);
  const edit = (i: number, patch: Partial<UserParameter>) =>
    setRows(shown.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const remove = async (i: number, at: { x: number; y: number }) => {
    const name = shown[i]!.name || `parameter ${i + 1}`;
    if (
      !(await confirm(`Delete ${name}? Fields that use it stop working.`, at))
    )
      return;
    setRows(shown.filter((_, j) => j !== i));
  };

  const apply = async () => {
    if (!document || !rows) return;
    setPending(true);
    try {
      await saveParameters(document, rows);
      setRows(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel id={PARAMETERS_PANEL} title="Parameters">
      <div className="dialog-body">
        <ListState error={error} loading={!document} empty={!shown.length} />
        <div role="list" aria-label="Parameters">
          {shown.map((row, i) => (
            <ParameterRow
              key={i}
              row={row}
              label={row.name || `parameter ${i + 1}`}
              checked={checked[i]!}
              canEdit={canEdit}
              onEdit={(patch) => edit(i, patch)}
              onDelete={(at) => void remove(i, at)}
            />
          ))}
        </div>
        {canEdit && document && (
          <button
            className="btn"
            onClick={() => setRows([...shown, blank(shown.length + 1)])}
          >
            Add parameter
          </button>
        )}
      </div>
      <DialogFooter
        {...(canEdit && { onOk: () => void apply() })}
        okLabel="Apply"
        okDisabled={invalid || !rows}
        pending={pending}
        onCancel={onClose}
        cancelLabel="Close"
      />
    </DraggablePanel>
  );
}

registerPanel({
  id: PARAMETERS_PANEL,
  title: "Parameters",
  when: (_, open) => open.includes(PARAMETERS_PANEL),
  component: () => (
    <ParametersPanel onClose={() => togglePanel(PARAMETERS_PANEL)} />
  ),
});
