import type { Command, CommandContext } from "./commands/registry";
import {
  bodyMadeBy,
  newId,
  type EvaluateResult,
  type TreeGroup,
} from "@rockett/shared";
import { api, type MutationResponse } from "./api";
import { freeProfileIds, sketchUsage } from "./sketchUsage";
import { selectionKey, useStore, isIdle, type Selection } from "./store";

type TreeKind = "body" | "sketch" | "plane";

function treeItems(selection: Selection[], kind: TreeKind): Selection[] {
  const items = new Map<string, Selection>();
  for (const s of selection) {
    const item: Selection =
      s.kind === "profile" && kind === "sketch"
        ? { kind: "sketch", sketchId: s.sketchId }
        : s;
    if (item.kind !== kind) return [];
    items.set(selectionKey(item), item);
  }
  return [...items.values()];
}

const idOf = (s: Selection) =>
  s.kind === "body" ? s.bodyId : s.kind === "sketch" ? s.sketchId : "";

export const treeIds = (selection: Selection[], kind: TreeGroup["kind"]) =>
  treeItems(selection, kind).map(idOf);

export function groupParts<T>(
  groups: TreeGroup[],
  collapsed: Record<string, boolean>,
  kind: TreeGroup["kind"],
  items: T[],
  selOf: (t: T) => Selection,
) {
  const own = groups.filter((g) => g.kind === kind);
  const inGroup = new Set(own.flatMap((g) => g.members));
  const parts = [
    ...own.map((group) => ({
      group,
      items: items.filter((t) => group.members.includes(idOf(selOf(t)))),
    })),
    { group: null, items: items.filter((t) => !inGroup.has(idOf(selOf(t)))) },
  ];
  const order = parts
    .flatMap((p) => (p.group && collapsed[p.group.id] ? [] : p.items))
    .map(selOf);
  return { parts, order };
}

export function treeRange(
  order: Selection[],
  anchor: Selection,
  item: Selection,
): Selection[] {
  const keys = order.map(selectionKey);
  const [from, to] = [
    keys.indexOf(selectionKey(anchor)),
    keys.indexOf(selectionKey(item)),
  ].toSorted((a, b) => a - b) as [number, number];
  return order.slice(from, to + 1);
}

export function treeClick(
  selection: Selection[],
  item: Selection,
  order: Selection[],
  anchor: Selection,
  range: boolean,
): Selection[] {
  if (range) return treeRange(order, anchor, item);
  const key = selectionKey(item);
  const base = treeItems(selection, item.kind as TreeKind);
  return base.some((s) => selectionKey(s) === key)
    ? base.filter((s) => selectionKey(s) !== key)
    : [...base, item];
}

function inOneStep(
  steps: ((projectId: string, tx: string) => Promise<MutationResponse>)[],
): Promise<void> {
  const s = useStore.getState();
  const id = s.document?.id;
  if (!id || steps.length === 0) return Promise.resolve();
  return s.mutate(async (tx) => {
    let last: MutationResponse | undefined;
    for (const step of steps) last = await step(id, tx);
    return last!;
  });
}

export const setBodiesVisible = (bodies: Record<string, boolean>) =>
  useStore.getState().setVisible({ bodies, features: {} });

export const setFeaturesVisible = (ids: string[], visible: boolean) =>
  useStore.getState().setVisible({
    bodies: {},
    features: Object.fromEntries(ids.map((id) => [id, visible])),
  });

type State = Pick<CommandContext, "document" | "evaluation" | "view">;

export function anyShown(
  s: State,
  kind: TreeGroup["kind"],
  ids: string[],
): boolean {
  if (kind === "body") {
    const hidden = new Set(s.view.hidden.bodies);
    return (s.evaluation?.bodies ?? []).some(
      (b) => ids.includes(b.bodyId) && !hidden.has(b.bodyId),
    );
  }
  const hidden = new Set(s.view.hidden.features);
  return (s.document?.features ?? []).some(
    (f) => f.type === "sketch" && ids.includes(f.id) && !hidden.has(f.id),
  );
}

export function showHide(kind: TreeGroup["kind"], ids: string[]): void {
  const visible = !anyShown(useStore.getState(), kind, ids);
  void (kind === "body"
    ? setBodiesVisible(Object.fromEntries(ids.map((id) => [id, visible])))
    : setFeaturesVisible(ids, visible));
}

export async function deleteFeatures(ids: string[]) {
  await inOneStep(ids.map((fid) => (id, tx) => api.deleteFeature(id, fid, tx)));
  useStore.getState().setSelection([]);
}

const saveGroups = (groups: TreeGroup[]) =>
  inOneStep([(id, tx) => api.updateGroups(id, groups, tx)]);

export async function groupItems(
  kind: TreeGroup["kind"],
  members: string[],
): Promise<TreeGroup | undefined> {
  const groups = useStore.getState().document?.groups;
  if (!groups || members.length === 0) return;
  const names = new Set(groups.map((g) => g.name));
  let n = 1;
  while (names.has(`Group ${n}`)) n++;
  const group = { id: newId("group"), name: `Group ${n}`, kind, members };
  await saveGroups([
    ...groups.map((g) => ({
      ...g,
      members: g.members.filter((m) => !members.includes(m)),
    })),
    group,
  ]);
  return group;
}

const groupRecipients: { created(id: string): void }[] = [];

export function registerGroupRecipient(
  created: (id: string) => void,
): () => void {
  const recipient = { created };
  groupRecipients.push(recipient);
  return () => {
    const index = groupRecipients.indexOf(recipient);
    if (index >= 0) groupRecipients.splice(index, 1);
  };
}

export const groupSelectionCommand = {
  id: "design.tree.group",
  label: "Group selected rows",
  description:
    "In the model tree, Ctrl or ⌘ + click adds or removes a body or sketch and Shift + click selects a range; right-click a selected row to act on all of them.",
  keys: ["Ctrl+G"],
  keyContext: "design",
  enabled: (s) =>
    (groupRecipients.length > 0 &&
      !s.busy &&
      isIdle(s) &&
      s.selection.some(
        (item) => item.kind === "body" || item.kind === "sketch",
      )) ||
    "Select rows while idle",
  run: async (s) => {
    const recipient = groupRecipients.at(-1);
    if (!recipient) return;
    const kind = treeIds(s.selection, "body").length > 0 ? "body" : "sketch";
    const group = await groupItems(kind, treeIds(s.selection, kind));
    if (group && groupRecipients.includes(recipient))
      recipient.created(group.id);
  },
} satisfies Command;

const editGroups = (edit: (groups: TreeGroup[]) => TreeGroup[]) =>
  saveGroups(edit(useStore.getState().document?.groups ?? []));

export const renameGroup = (id: string, name: string) =>
  editGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name } : g)));

export const ungroup = (id: string) =>
  editGroups((gs) => gs.filter((g) => g.id !== id));

export const sketchSel = (f: { id: string }): Selection => ({
  kind: "sketch",
  sketchId: f.id,
});

export const bodySel = (b: { bodyId: string }): Selection => ({
  kind: "body",
  bodyId: b.bodyId,
});

export function featureBodies(
  evaluation: EvaluateResult | null,
  featureId: string,
): Selection[] {
  const st = evaluation?.featureStatuses.find((x) => x.featureId === featureId);
  if (st?.status !== "ok" && st?.status !== "warning") return [];
  return (evaluation?.bodies ?? [])
    .filter(
      (b) => bodyMadeBy(featureId, b.bodyId) || st.targets?.includes(b.bodyId),
    )
    .map(bodySel);
}

export function sketchRegions(sketchId: string): Selection[] {
  const s = useStore.getState();
  const sk = s.evaluation?.sketches.find((x) => x.featureId === sketchId);
  const profiles = sk?.profiles ?? [];
  const free = s.document
    ? freeProfileIds(sketchUsage(s.document), sketchId, profiles)
    : [];
  const ids = free.length > 0 ? free : profiles.map((p) => p.id);
  return ids.map((id) => ({ kind: "profile", sketchId, profileId: id }));
}

export const selectSketchRegions = (sketchId: string) =>
  useStore.getState().setSelection(sketchRegions(sketchId));
