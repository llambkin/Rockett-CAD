import { createElement as h, Fragment } from "react";
import type { ClientContext } from "@rockett/plugin-api";
import type { Fixture, StockSetup } from "../shared/setup.js";
import { button, dimmed } from "./libraryParts.js";

export type HoldDownKind = "toeClamp" | "screw" | "box" | "tape" | "vacuum";

export type HoldDown = {
  kind: HoldDownKind;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
};

export type Draft = { setup: StockSetup; fixtures: Fixture[] } | null;

const LABELS: Record<HoldDownKind, string> = {
  toeClamp: "Toe clamp",
  screw: "Screw",
  box: "Custom box",
  tape: "Tape",
  vacuum: "Vacuum",
};

const KINDS = Object.entries(LABELS) as [HoldDownKind, string][];

const WHOLE_STOCK = new Set<HoldDownKind>(["tape", "vacuum"]);

const NEW_HOLD_DOWN: HoldDown = {
  kind: "toeClamp",
  x: 0,
  y: 0,
  width: 40,
  depth: 20,
  height: 25,
};

type Size = Exclude<keyof HoldDown, "kind">;

const SIZES: [Size, string][] = [
  ["x", "X"],
  ["y", "Y"],
  ["width", "W"],
  ["depth", "D"],
  ["height", "H"],
];

const POSITIVE = new Set<Size>(["width", "depth"]);

export function fixturesOf(holdDowns: HoldDown[]): Fixture[] {
  const counts = new Map<HoldDownKind, number>();
  return holdDowns.flatMap(({ kind, x, y, width, depth, height }) => {
    if (WHOLE_STOCK.has(kind)) return [];
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return [
      {
        name: `${LABELS[kind].toLowerCase()} ${count}`,
        min: [x, y, Math.min(0, height)],
        max: [x + width, y + depth, height],
      },
    ];
  });
}

export function holdDownDraft() {
  let value: Draft = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: Draft) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type HoldDownDraft = ReturnType<typeof holdDownDraft>;

export function holdDownRows(
  ui: ClientContext["ui"],
  holdDowns: HoldDown[],
  set: (next: HoldDown[]) => void,
) {
  const change = (i: number, patch: Partial<HoldDown>) =>
    set(holdDowns.map((each, j) => (j === i ? { ...each, ...patch } : each)));
  const rows = holdDowns.map((holdDown, i) =>
    h(
      "div",
      {
        key: i,
        role: "group",
        "aria-label": `Hold-down ${i + 1}`,
      },
      h(ui.SelectField<HoldDownKind>, {
        label: "Hold-down",
        value: holdDown.kind,
        options: KINDS,
        onChange: (kind) => change(i, { kind }),
      }),
      WHOLE_STOCK.has(holdDown.kind)
        ? h(
            "span",
            { className: "field-hint" },
            "holds the whole stock, no keep-out",
          )
        : SIZES.map(([key, label]) =>
            h(ui.LengthField, {
              key,
              label,
              value: holdDown[key],
              ...(POSITIVE.has(key) && { above: 0 }),
              onChange: (value) => change(i, { [key]: value }),
            }),
          ),
      button("x", `Remove hold-down ${i + 1}`, false, () =>
        set(holdDowns.filter((_, j) => j !== i)),
      ),
    ),
  );
  return h(
    Fragment,
    null,
    dimmed("Hold-downs"),
    ...rows,
    button("Add hold-down", "Add hold-down", false, () =>
      set([...holdDowns, NEW_HOLD_DOWN]),
    ),
    !holdDowns.length &&
      h(
        "span",
        { className: "field-hint" },
        "No hold-downs. The stock must be held another way.",
      ),
  );
}
