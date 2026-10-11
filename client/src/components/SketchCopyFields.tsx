import type { PatternDirection, SketchCopy, Units } from "@rockett/shared";
import {
  AngleField,
  CheckField,
  LengthField,
  NumField,
  SelectField,
} from "./form/fields";

export type Target = "pivot" | "mirror" | "first" | "second" | "centre";
export type Picks = Partial<Record<Target, string>>;
type Axis = "x" | "y" | "line";
type Direction = Omit<PatternDirection, "axis"> & { axis: Axis };

export interface CopyParams {
  first: Direction;
  second: Direction | null;
  centre: "origin" | "point";
  count: number;
  angle: number;
}

export const COPY_START: CopyParams = {
  first: { axis: "x", count: 3, spacing: 10 },
  second: null,
  centre: "origin",
  count: 6,
  angle: 360,
};

const SECOND: Direction = { axis: "y", count: 2, spacing: 10 };

export interface Picking {
  target: Target | null;
  name: (target: Target) => string | null;
  onPick: (target: Target) => void;
}

export function PickField({
  target,
  picking,
  hint,
}: {
  target: Target;
  picking: Picking;
  hint: string;
}) {
  const point = target === "pivot" || target === "centre";
  const active = picking.target === target;
  const name = picking.name(target);
  return (
    <>
      <button
        className="btn"
        aria-pressed={active}
        onClick={() => picking.onPick(target)}
      >
        {active ? "Stop" : point ? "Pick point" : "Pick line"}
      </button>
      <p className="field-hint">
        {active
          ? `Click a sketch ${point ? "point" : "line"} ${hint}.`
          : (name ?? `No ${point ? "point" : "line"} picked yet.`)}
      </p>
    </>
  );
}

function axisOf(
  d: Direction,
  target: Target,
  picks: Picks,
): PatternDirection["axis"] {
  if (d.axis !== "line") return d.axis;
  const line = picks[target];
  if (!line) throw new Error("Pick a sketch line for each direction.");
  return { line };
}

export function sketchCopy(
  mode: "mirror" | "rect" | "circ",
  p: CopyParams,
  picks: Picks,
  at: (id: string | undefined) => { x: number; y: number } | null,
): SketchCopy {
  if (mode === "mirror") {
    if (!picks.mirror) throw new Error("Pick a sketch line to mirror across.");
    return { kind: "mirror", line: picks.mirror };
  }
  if (mode === "rect")
    return {
      kind: "rect",
      first: { ...p.first, axis: axisOf(p.first, "first", picks) },
      second: p.second && {
        ...p.second,
        axis: axisOf(p.second, "second", picks),
      },
    };
  const centre = p.centre === "origin" ? { x: 0, y: 0 } : at(picks.centre);
  if (!centre) throw new Error("Pick a sketch point for the centre.");
  return { kind: "circ", centre, count: p.count, angle: p.angle };
}

function DirectionFields({
  n,
  d,
  set,
  picking,
  units,
}: {
  n: "" | " 2";
  d: Direction;
  set: (d: Direction) => void;
  picking: Picking;
  units: Units;
}) {
  return (
    <>
      <SelectField
        label={`Direction${n}`}
        value={d.axis}
        options={[
          ["x", "X axis"],
          ["y", "Y axis"],
          ["line", "Sketch line"],
        ]}
        onChange={(axis) => set({ ...d, axis })}
      />
      {d.axis === "line" && (
        <PickField
          target={n ? "second" : "first"}
          picking={picking}
          hint="to pattern along"
        />
      )}
      <NumField
        label={`Quantity${n}`}
        int
        min={1}
        value={d.count}
        onChange={(count) => set({ ...d, count })}
      />
      <LengthField
        label={`Spacing${n}`}
        units={units}
        step={1}
        value={d.spacing}
        onChange={(spacing) => set({ ...d, spacing })}
      />
    </>
  );
}

export function CopyFields({
  mode,
  params: p,
  set,
  picking,
  units,
}: {
  mode: "mirror" | "rect" | "circ";
  params: CopyParams;
  set: (p: CopyParams) => void;
  picking: Picking;
  units: Units;
}) {
  if (mode === "mirror")
    return (
      <PickField target="mirror" picking={picking} hint="to mirror across" />
    );
  if (mode === "circ")
    return (
      <>
        <SelectField
          label="Centre"
          value={p.centre}
          options={[
            ["origin", "Sketch origin"],
            ["point", "Picked point"],
          ]}
          onChange={(centre) => set({ ...p, centre })}
        />
        {p.centre === "point" && (
          <PickField target="centre" picking={picking} hint="as the centre" />
        )}
        <NumField
          label="Quantity"
          int
          min={1}
          value={p.count}
          onChange={(count) => set({ ...p, count })}
        />
        <AngleField
          label="Total angle"
          step={15}
          value={p.angle}
          onChange={(angle) => set({ ...p, angle })}
        />
      </>
    );
  return (
    <>
      <DirectionFields
        n=""
        d={p.first}
        set={(first) => set({ ...p, first })}
        picking={picking}
        units={units}
      />
      <CheckField
        label="Second direction"
        value={!!p.second}
        onChange={(on) => set({ ...p, second: on ? SECOND : null })}
      />
      {p.second && (
        <DirectionFields
          n=" 2"
          d={p.second}
          set={(second) => set({ ...p, second })}
          picking={picking}
          units={units}
        />
      )}
    </>
  );
}
