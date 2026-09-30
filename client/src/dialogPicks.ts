import {
  previewBodies,
  selectionKey,
  useStore,
  type DialogType,
  type Selection,
} from "./store";
import { featureUI } from "./features/registry";
import { chosenTargets, several, targetOperation } from "./toolTargets";
import { sketchRegions } from "./treeSelection";

type Store = ReturnType<typeof useStore.getState>;
type Kind = Selection["kind"];

export interface PickInput {
  key: string;
  kinds: readonly Kind[];
  one?: true;
  planar?: true;
  straight?: true;
  optional?: true;
  shiftFaces?: true;
  accumulate?: true;
  param?: {
    read: (s: Store) => Selection[];
    write: (next: Selection[], s: Store) => void;
  };
}

const input = (
  key: string,
  kinds: readonly Kind[],
  rules: Omit<PickInput, "key" | "kinds"> = {},
): PickInput => ({ key, kinds, ...rules });

export const profiles = input("profiles", ["profile"]);
export const profilesOrFaces = input("profiles", ["profile", "face"], {
  planar: true,
  shiftFaces: true,
});
export const sections = input("profiles", ["profile", "face"], {
  planar: true,
  accumulate: true,
});
export const targets = input("targets", ["body"], {
  optional: true,
  param: {
    read: (s) =>
      s.mode.name !== "dialog"
        ? []
        : chosenTargets(
            targetOperation(s.mode.dialog, s.dialogParams),
            s.dialogParams.targets,
            s.document?.namingVersion,
          ).map((bodyId) => ({ kind: "body", bodyId })),
    write: (next, s) => {
      const ids = next.flatMap((x) => (x.kind === "body" ? [x.bodyId] : []));
      s.setDialogParams({ targets: ids.length > 0 ? ids : undefined });
    },
  },
});

export const bodies = input("bodies", ["body"]);
export const edges = input("edges", ["edge"]);
const line = { one: true, straight: true } as const;
export const axis = input("axis", ["edge", "sketchEntity", "axis"], line);
export const planar = (key: string, one: boolean) =>
  input(key, ["plane", "face"], { planar: true, ...(one && { one: true }) });

const DIALOG_INPUTS: Partial<Record<DialogType, readonly PickInput[]>> = {
  export: [bodies],
};

const picksOf = (dialog: DialogType): readonly PickInput[] =>
  featureUI(dialog)?.picks ?? DIALOG_INPUTS[dialog] ?? [];

const inSelection = (i: PickInput) => !i.param;

export function takes(dialog: DialogType, kind: Kind): boolean {
  return picksOf(dialog).some((i) => inSelection(i) && i.kinds.includes(kind));
}

export function filterSelectionFor(
  dialog: DialogType,
  selection: Selection[],
): Selection[] {
  const s = useStore.getState();
  const inputs = picksOf(dialog).filter(
    (i) =>
      inSelection(i) &&
      (!i.straight || !i.one || held(i, selection).length === 1),
  );
  return selection.filter((sel) =>
    inputs.some(
      (i) => i.kinds.includes(sel.kind) && accepted(i, sel, s).length > 0,
    ),
  );
}

function inputsFor(
  dialog: DialogType,
  params: Record<string, any>,
): readonly PickInput[] {
  return featureUI(dialog)?.picksFor?.(params) ?? picksOf(dialog);
}

export function takesAxis(
  dialog: DialogType,
  params: Record<string, any>,
): boolean {
  return inputsFor(dialog, params).some(
    (i) => inSelection(i) && !!i.one && i.kinds.includes("axis"),
  );
}

function dialogInputs(s: Store): PickInput[] {
  if (s.mode.name !== "dialog") return [];
  const operation = targetOperation(s.mode.dialog, s.dialogParams);
  return inputsFor(s.mode.dialog, s.dialogParams).flatMap((i) => {
    if (i !== targets) return [i];
    if (operation === "newBody") return [];
    return several(operation, s.document?.namingVersion)
      ? [i]
      : [{ ...i, one: true as const }];
  });
}

const held = (i: PickInput | undefined, selection: Selection[]) =>
  selection.filter((x) => !!i?.kinds.includes(x.kind));

export function heldBy(
  dialog: DialogType,
  key: string,
  selection: Selection[],
): Selection[] {
  return held(
    picksOf(dialog).find((i) => i.key === key),
    selection,
  );
}

function inputPicks(i: PickInput, s: Store): Selection[] {
  return i.param ? i.param.read(s) : held(i, s.selection);
}

const empty = (s: Store) => (i: PickInput) =>
  !i.optional && inputPicks(i, s).length === 0;

export function activeInput(s: Store): PickInput | undefined {
  const inputs = dialogInputs(s);
  return (
    inputs.find((i) => i.key === s.pickInput) ??
    inputs.find(empty(s)) ??
    inputs[0]
  );
}

export function isPlanarFace(sel: Selection, s: Store): boolean {
  if (sel.kind !== "face") return false;
  const body = previewBodies(s).find((b) => b.bodyId === sel.bodyId);
  const face = body?.faces.find((f) => f.name === sel.faceName);
  return face?.surface.type === "plane";
}

function fits(i: PickInput, sel: Selection, s: Store): boolean {
  if (!i.kinds.includes(sel.kind)) return false;
  return !(i.planar && sel.kind === "face" && !isPlanarFace(sel, s));
}

function isStraight(sel: Selection, s: Store): boolean {
  if (sel.kind === "edge") {
    const body = previewBodies(s).find((b) => b.bodyId === sel.bodyId);
    return (
      body?.edges.find((e) => e.name === sel.edgeName)?.curve.type === "line"
    );
  }
  if (sel.kind !== "sketchEntity") return true;
  const sketch = s.document?.features.find((f) => f.id === sel.sketchId);
  return (
    sketch?.type === "sketch" &&
    sketch.entities.find((e) => e.id === sel.entityId)?.kind === "line"
  );
}

export function pickOptions(i: PickInput | undefined, shift?: boolean) {
  const has = (kind: Kind) => !!i?.kinds.includes(kind);
  const split = shift !== undefined && !!i?.shiftFaces;
  return {
    profiles: has("profile") && !(split && shift),
    edges: has("edge"),
    vertices: has("vertex"),
    faces: has("face") && (!split || shift),
    bodies: has("body") && !has("face"),
    originPlanes: has("plane"),
    constructionPlanes: has("plane"),
    originAxes: has("axis"),
    sketchEntities: has("sketchEntity") || has("sketchPoint"),
  };
}

export function dialogPickOptions(s: Store, shift?: boolean) {
  const repair: { kind: "face" | "edge" } | undefined = s.dialogParams.repick;
  if (repair)
    return { faces: repair.kind === "face", edges: repair.kind === "edge" };
  return pickOptions(activeInput(s), shift);
}

export function accepted(
  i: PickInput | undefined,
  sel: Selection | null,
  s: Store,
): Selection[] {
  if (!i || !sel) return [];
  const has = (kind: Kind) => i.kinds.includes(kind);
  if (sel.kind === "face" && !has("face") && has("body"))
    return [{ kind: "body", bodyId: sel.bodyId }];
  if (sel.kind === "sketch" && has("profile"))
    return sketchRegions(sel.sketchId);
  if (!fits(i, sel, s)) return [];
  if (i.straight && !isStraight(sel, s)) return [];
  return [sel];
}

export function hoverPick(s: Store, sel: Selection | null): Selection | null {
  if (s.dialogParams.repick) return sel;
  return accepted(activeInput(s), sel, s)[0] ?? null;
}

function toggled(had: Selection[], taken: Selection[]): Selection[] {
  let next = had;
  for (const t of taken) {
    const key = selectionKey(t);
    next = next.some((x) => selectionKey(x) === key)
      ? next.filter((x) => selectionKey(x) !== key)
      : [...next, t];
  }
  return next;
}

function replaced(i: PickInput, had: Selection[], taken: Selection[]) {
  const same =
    had.length === 1 &&
    taken.length === 1 &&
    selectionKey(had[0]!) === selectionKey(taken[0]!);
  if (same) return [];
  return i.one ? taken.slice(-1) : taken;
}

function write(i: PickInput, next: Selection[], s: Store) {
  if (i.param) return i.param.write(next, s);
  s.setSelection([
    ...s.selection.filter((x) => !i.kinds.includes(x.kind)),
    ...next,
  ]);
}

export function clearInput(key: string) {
  const s = useStore.getState();
  const i = dialogInputs(s).find((x) => x.key === key);
  if (i) write(i, [], s);
}

function following(key: string, s: Store): PickInput | undefined {
  const inputs = dialogInputs(s);
  const at = inputs.findIndex((i) => i.key === key);
  return (
    [...inputs.slice(at + 1), ...inputs.slice(0, at)].find(empty(s)) ??
    inputs.find((i) => !i.one)
  );
}

export function pickInto(picks: readonly Selection[], additive: boolean) {
  const s = useStore.getState();
  const i = activeInput(s);
  const taken = picks.flatMap((p) => accepted(i, p, s));
  if (!i || taken.length === 0) return;
  const had = inputPicks(i, s);
  const toggles =
    !i.one &&
    (i.accumulate || additive || taken.some((t) => t.kind !== "profile"));
  const next = toggles ? toggled(had, taken) : replaced(i, had, taken);
  write(i, next, s);
  const after = useStore.getState();
  const pass = i.one && next.length > 0 ? following(i.key, after) : undefined;
  after.setPickInput((pass ?? i).key);
}
