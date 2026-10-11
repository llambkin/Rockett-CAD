import { useEffect, useMemo, useState } from "react";
import {
  boundConstraintIds,
  copySketchSelection,
  FixedEntityError,
  formatLength,
  moveSketchSelection,
  type SketchFeature,
  type SketchModification,
  type Units,
} from "@rockett/shared";
import { useStore, type Selection } from "../store";
import { useSetting } from "../settings";
import { pickLabel } from "../selection/labels";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import {
  AngleField,
  CheckField,
  LengthField,
  SelectField,
} from "./form/fields";
import { useSketchPreview } from "./SketchOffsetPanel";
import {
  COPY_START,
  CopyFields,
  PickField,
  sketchCopy,
  type CopyParams,
  type Picking,
  type Picks,
  type Target,
} from "./SketchCopyFields";

type Move = { dx: number; dy: number; angle: number; copy: boolean };
const START: Move = { dx: 0, dy: 0, angle: 0, copy: false };

export function SketchMove() {
  const draft = useStore((s) => s.draftSketch);
  return draft && <SketchMovePanel draft={draft} />;
}

const sketchIds = (selection: Selection[], sketchId: string) =>
  selection.flatMap((s) =>
    (s.kind === "sketchEntity" || s.kind === "sketchPoint") &&
    s.sketchId === sketchId
      ? [s.entityId]
      : [],
  );

function entityName(draft: SketchFeature, entityId: string): string {
  const { document, evaluation } = useStore.getState();
  return pickLabel(
    { kind: "sketchEntity", sketchId: draft.id, entityId },
    document,
    evaluation,
    [],
  );
}

function refusal(e: unknown, draft: SketchFeature): string {
  if (!(e instanceof FixedEntityError)) return (e as Error).message;
  return `${entityName(draft, e.entityId)}: ${e.message}`;
}

const WANTS: Record<Target, "point" | "line"> = {
  pivot: "point",
  centre: "point",
  mirror: "line",
  first: "line",
  second: "line",
};

function usePicks(draft: SketchFeature) {
  const selection = useStore((s) => s.selection);
  const [held, setHeld] = useState<{
    target: Target;
    selection: Selection[];
  } | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  useEffect(() => {
    if (!held) return;
    const picked = sketchIds(selection, draft.id)
      .map((id) => draft.entities.find((e) => e.id === id))
      .find((e) => e?.kind === WANTS[held.target]);
    if (!picked) return;
    setPicks((p) => ({ ...p, [held.target]: picked.id }));
    setHeld(null);
    useStore.getState().setSelection(held.selection);
  }, [selection, held, draft]);
  const toggle = (target: Target) => {
    const s = useStore.getState();
    if (held?.target === target) {
      setHeld(null);
      s.setSelection(held.selection);
      return;
    }
    setHeld({ target, selection: held?.selection ?? s.selection });
    s.setSelection([]);
  };
  const shown = held?.selection ?? selection;
  const ids = useMemo(() => sketchIds(shown, draft.id), [shown, draft.id]);
  return { ids, held, picks, toggle };
}

function MoveFields({
  move,
  setMove,
  units,
}: {
  move: Move;
  setMove: (move: Move) => void;
  units: Units;
}) {
  return (
    <>
      <LengthField
        label="X distance"
        units={units}
        step={1}
        ariaLabel="Move X distance"
        autoFocus
        value={move.dx}
        onChange={(dx) => setMove({ ...move, dx })}
      />
      <LengthField
        label="Y distance"
        units={units}
        step={1}
        ariaLabel="Move Y distance"
        value={move.dy}
        onChange={(dy) => setMove({ ...move, dy })}
      />
      <AngleField
        label="Angle"
        step={15}
        ariaLabel="Move angle"
        value={move.angle}
        onChange={(angle) => setMove({ ...move, angle })}
      />
    </>
  );
}

type About = "centre" | "point";
type Mode = "move" | "mirror" | "rect" | "circ";

const MODES: [Mode, string][] = [
  ["move", "Move"],
  ["mirror", "Mirror"],
  ["rect", "Rect Pattern"],
  ["circ", "Circ Pattern"],
];

function PivotFields({
  about,
  setAbout,
  picking,
}: {
  about: About;
  setAbout: (v: About) => void;
  picking: Picking;
}) {
  return (
    <>
      <SelectField
        label="Rotate about"
        value={about}
        options={[
          ["centre", "Selection centre"],
          ["point", "Picked point"],
        ]}
        onChange={setAbout}
      />
      {about === "point" && (
        <PickField target="pivot" picking={picking} hint="to rotate about" />
      )}
    </>
  );
}

interface Choice {
  mode: Mode;
  move: Move;
  about: About;
  copy: CopyParams;
  picks: Picks;
}

function usePreview(draft: SketchFeature, ids: string[], c: Choice) {
  const document = useStore((s) => s.document);
  return useMemo(() => {
    if (!ids.length) return { result: null, error: null };
    const at = (id: string | undefined) => {
      const e = draft.entities.find((x) => x.id === id);
      return e?.kind === "point" ? { x: e.x, y: e.y } : null;
    };
    const saved = document?.features.find((f) => f.id === draft.id);
    const bound =
      document && saved?.type === "sketch"
        ? boundConstraintIds(document.parameterBindings, saved)
        : [];
    const { entities, constraints } = draft;
    try {
      if (c.mode !== "move") {
        const pattern = sketchCopy(c.mode, c.copy, c.picks, at);
        const result = copySketchSelection(entities, constraints, ids, pattern);
        return { result, error: null };
      }
      const pivot = c.about === "point" ? at(c.picks.pivot) : null;
      if (c.about === "point" && !pivot)
        return { result: null, error: "Pick a sketch point to rotate about." };
      const result = moveSketchSelection(entities, constraints, ids, {
        ...c.move,
        pivot,
        bound,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: refusal(e, draft) };
    }
  }, [draft, ids, c, document]);
}

function usePicking(
  draft: SketchFeature,
  held: Target | null,
  picks: Picks,
  toggle: (t: Target) => void,
): Picking {
  const units = useSetting("units.length");
  const name = (target: Target) => {
    const id = picks[target];
    const e = draft.entities.find((x) => x.id === id);
    if (e?.kind === "point") {
      const at = `${formatLength(e.x, units)}, ${formatLength(e.y, units)}`;
      return target === "pivot" ? `Rotates about ${at}.` : `Centre at ${at}.`;
    }
    if (!e) return null;
    const line = entityName(draft, e.id);
    return target === "mirror" ? `Mirrors across ${line}.` : `Along ${line}.`;
  };
  return { target: held, name, onPick: toggle };
}

async function apply(
  draft: SketchFeature,
  result: SketchModification | null,
  close: () => void,
) {
  const s = useStore.getState();
  if (!result || s.busy) return;
  if (s.updateDraftSketch(result.entities, result.constraints)) return;
  try {
    await s.commitDraftSketch();
    close();
  } catch (e) {
    useStore.setState({ draftSketch: draft });
    s.setError((e as Error).message);
  }
}

function SketchMovePanel({ draft }: { draft: SketchFeature }) {
  const units = useSetting("units.length");
  const busy = useStore((s) => s.busy);
  const { ids, held, picks, toggle } = usePicks(draft);
  const picking = usePicking(draft, held?.target ?? null, picks, toggle);
  const [mode, setMode] = useState<Mode>("move");
  const [move, setMove] = useState<Move>(START);
  const [about, setAbout] = useState<About>("centre");
  const [copy, setCopy] = useState<CopyParams>(COPY_START);
  const choice = useMemo(
    () => ({ mode, move, about, copy, picks }),
    [mode, move, about, copy, picks],
  );
  const preview = usePreview(draft, ids, choice);
  const copying = mode !== "move" || move.copy;
  useSketchPreview(
    "sketchMovePreview",
    preview.result,
    copying ? undefined : ids,
  );
  const removed = preview.result?.removedConstraints ?? 0;
  const close = () => {
    if (held) toggle(held.target);
    useStore.getState().setSketchState({ moveCopy: false });
  };
  return (
    <DraggablePanel id="sketch.moveCopy" title="Move/Copy">
      <div className="dialog-body">
        <p>
          {ids.length
            ? `${ids.length} item${ids.length === 1 ? "" : "s"} selected · Ctrl-click or drag a window to change the selection`
            : "Select sketch geometry. Ctrl-click adds; drag from empty space to window-select."}
        </p>
        <SelectField
          label="Type"
          value={mode}
          options={MODES}
          onChange={setMode}
        />
        {mode === "move" ? (
          <>
            <MoveFields move={move} setMove={setMove} units={units} />
            <PivotFields about={about} setAbout={setAbout} picking={picking} />
            <CheckField
              label="Copy"
              value={move.copy}
              onChange={(c) => setMove({ ...move, copy: c })}
            />
          </>
        ) : (
          <CopyFields
            mode={mode}
            params={copy}
            set={setCopy}
            picking={picking}
            units={units}
          />
        )}
        {removed > 0 && (
          <p className="field-hint">
            {copying ? "The copy leaves out" : "Removes"} {removed} constraint
            {removed === 1 ? "" : "s"} linking the selection to other geometry,
            the sketch axes or a parameter.
          </p>
        )}
        {preview.error && <p className="field-hint">{preview.error}</p>}
      </div>
      <DialogFooter
        onOk={() => void apply(draft, preview.result, close)}
        onCancel={close}
        pending={busy}
        okDisabled={!preview.result}
      />
    </DraggablePanel>
  );
}
