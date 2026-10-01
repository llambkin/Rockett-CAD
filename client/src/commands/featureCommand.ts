import { selectionBeforeCommand } from "../selection/kinds";
import type { ActiveCommand, PickModifiers } from "./active";
import { repick } from "../featureReferences";
import type { Feature } from "@rockett/shared";
import { pickProviders } from "../three/pickProviders";
import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../store";
import { featureUI, type DialogFeatureUI } from "../features/registry";
import { chosenTargets, several, targetOperation } from "../toolTargets";
import { sketchRegions } from "../treeSelection";

type Store = ReturnType<typeof useStore.getState>;
type Kind = Selection["kind"];

export interface PickInput {
  key: string;
  providers: readonly string[];
  wholeSketch?: true;
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
  providers: readonly string[],
  rules: Omit<PickInput, "key" | "providers"> = {},
): PickInput => ({ key, providers, ...rules });

export const profiles = input("profiles", ["sketch.profile"]);
export const profilesOrFaces = input(
  "profiles",
  ["sketch.profile", "design.face"],
  {
    planar: true,
    shiftFaces: true,
  },
);
export const sections = input("profiles", ["sketch.profile", "design.face"], {
  planar: true,
  accumulate: true,
});
export const targets = input("targets", ["design.body"], {
  optional: true,
  param: {
    read: (s) =>
      s.active?.id !== "design.feature"
        ? []
        : chosenTargets(
            targetOperation(s.active.state.type, s.dialogParams),
            s.dialogParams.targets,
            s.document?.namingVersion,
          ).map((bodyId) => ({ kind: "body", bodyId })),
    write: (next, s) => {
      const ids = next.flatMap((x) => (x.kind === "body" ? [x.bodyId] : []));
      s.setDialogParams({ targets: ids.length > 0 ? ids : undefined });
    },
  },
});

export const bodies = input("bodies", ["design.body"]);
export const edges = input("edges", ["design.edge"]);
const line = { one: true, straight: true } as const;
export const axis = input(
  "axis",
  ["design.edge", "sketch.entity", "design.originAxis"],
  line,
);
export const planar = (key: string, one: boolean) =>
  input(
    key,
    ["design.originPlane", "design.constructionPlane", "design.face"],
    { planar: true, ...(one && { one: true }) },
  );

const picksOf = (dialog: Feature["type"]): readonly PickInput[] =>
  featureUI(dialog)?.picks ?? [];

const inSelection = (i: PickInput) => !i.param;

export function takes(dialog: Feature["type"], kind: Kind): boolean {
  return picksOf(dialog).some(
    (i) => inSelection(i) && kindsOf(i).includes(kind),
  );
}

export function preselectionFor(
  dialog: Feature["type"],
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
      (i) => kindsOf(i).includes(sel.kind) && accepted(i, sel, s).length > 0,
    ),
  );
}

function inputsFor(
  dialog: Feature["type"],
  params: Record<string, any>,
): readonly PickInput[] {
  return featureUI(dialog)?.picksFor?.(params) ?? picksOf(dialog);
}

export function takesAxis(
  dialog: Feature["type"],
  params: Record<string, any>,
): boolean {
  return inputsFor(dialog, params).some(
    (i) => inSelection(i) && !!i.one && kindsOf(i).includes("axis"),
  );
}

function dialogInputs(s: Store): PickInput[] {
  if (s.active?.id !== "design.feature") return [];
  const operation = targetOperation(s.active.state.type, s.dialogParams);
  return inputsFor(s.active.state.type, s.dialogParams).flatMap((i) => {
    if (i !== targets) return [i];
    if (operation === "newBody") return [];
    return several(operation, s.document?.namingVersion)
      ? [i]
      : [{ ...i, one: true as const }];
  });
}

const held = (i: PickInput | undefined, selection: Selection[]) =>
  selection.filter((x) => !!kindsOf(i).includes(x.kind));

export function readInput(key: string, s: Store): Selection[] {
  const i = dialogInputs(s).find((x) => x.key === key);
  return i ? inputPicks(i, s) : [];
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
  if (
    !kindsOf(i).includes(sel.kind) &&
    !(i.wholeSketch && sel.kind === "sketch")
  )
    return false;
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

function kindsOf(i: PickInput | undefined): Kind[] {
  return [
    ...pickProviders().flatMap((p) =>
      i?.providers.includes(p.id) ? [p.kind] : [],
    ),
    ...(i?.wholeSketch ? ["sketch" as const] : []),
  ];
}

export function pickProviderIds(
  i: PickInput | undefined,
  shift?: boolean,
): string[] {
  if (!i) return [];
  const kinds = kindsOf(i);
  const split = shift !== undefined && !!i.shiftFaces;
  const ids = i.providers.filter((id) => {
    const kind = pickProviders().find((p) => p.id === id)?.kind;
    return kind === "profile"
      ? !(split && shift)
      : kind === "face"
        ? !split || shift
        : kind === "body"
          ? !kinds.includes("face")
          : true;
  });
  if (kinds.includes("sketchPoint") && !kinds.includes("sketchEntity"))
    ids.push("sketch.entity");
  return pickProviders()
    .filter((p) => ids.includes(p.id))
    .map((p) => p.id);
}

function featurePickProviders(s: Store, shift?: boolean): string[] {
  const repair: { kind: "face" | "edge" } | undefined = s.dialogParams.repick;
  return pickProviderIds(
    repair
      ? { key: "repick", providers: [`design.${repair.kind}`] }
      : activeInput(s),
    shift,
  );
}

export function accepted(
  i: PickInput | undefined,
  sel: Selection | null,
  s: Store,
): Selection[] {
  if (!i || !sel) return [];
  const has = (kind: Kind) => kindsOf(i).includes(kind);
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
    ...s.selection.filter((x) => !kindsOf(i).includes(x.kind)),
    ...next,
  ]);
}

export function clearInput(key: string, keys?: string[]) {
  const s = useStore.getState();
  const i = dialogInputs(s).find((x) => x.key === key);
  if (!i) return;
  const had = inputPicks(i, s);
  const gone = new Set(keys ?? had.map(selectionKey));
  if (i.param)
    return i.param.write(
      had.filter((x) => !gone.has(selectionKey(x))),
      s,
    );
  s.setSelection(
    s.selection.filter(
      (x) => !kindsOf(i).includes(x.kind) || !gone.has(selectionKey(x)),
    ),
  );
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

export interface FeatureCommandState {
  type: Feature["type"];
  editFeatureId?: string;
  selectionBefore: Selection[];
}

export const featureCommand = {
  enter(
    type?: FeatureCommandState["type"],
    initial?: {
      editFeatureId?: string;
      params?: Record<string, any>;
      selection: Selection[];
    },
  ) {
    if (!type || !featureUI(type)) return;
    const s = useStore.getState();
    const selectionBefore = selectionBeforeCommand(s);
    const selection = initial?.selection ?? preselectionFor(type, s.selection);
    s.setMode({ name: "idle" });
    useStore.setState({
      active: {
        id: "design.feature",
        state: {
          type,
          selectionBefore,
          ...(initial?.editFeatureId && {
            editFeatureId: initial.editFeatureId,
          }),
        },
      },
      dialogParams: initial?.params ?? {},
      selection,
      hover: null,
    });
  },
  exit() {
    useStore.getState().cancelDialog();
  },
  pickFilter(event?: Pick<PointerEvent, "shiftKey">) {
    return featurePickProviders(useStore.getState(), event?.shiftKey);
  },
  onHover(selection: Selection | null) {
    return hoverPick(useStore.getState(), selection);
  },
  async onClick(selection: Selection | null, event: PickModifiers) {
    const s = useStore.getState();
    if (s.active?.id !== "design.feature" || s.busy) return;
    if (repick(selection)) return;
    const sel = accepted(activeInput(s), selection, s)[0] ?? null;
    const taken = sel && featureUI(s.active.state.type)?.onPick?.(sel, s);
    if (taken) return taken;
    if (sel) pickInto([sel], event.ctrlKey || event.metaKey || event.shiftKey);
  },
  onSelection: pickInto,
  onContextMenu() {},
  hint: "",
  panel: "design.feature",
  keyContext: "design.feature",
} satisfies ActiveCommand;

export async function openInDialog(
  ui: DialogFeatureUI,
  f: Feature,
): Promise<void> {
  if (useStore.getState().mode.name === "sketch") {
    await useStore.getState().finishSketch();
    if (useStore.getState().mode.name === "sketch") return;
  }
  const { params, selection } = ui.prefill(f);
  featureCommand.enter(ui.type, { editFeatureId: f.id, params, selection });
}
