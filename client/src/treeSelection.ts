import { newId, type TreeGroup } from "@rockett/shared";
import { api, type MutationResponse } from "./api";
import { freeProfileIds, sketchUsage } from "./sketchUsage";
import { selectionKey, useStore, type Selection } from "./store";

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

export function treeClick(
  selection: Selection[],
  item: Selection,
  order: Selection[],
  anchor: Selection,
  range: boolean,
): Selection[] {
  const keys = order.map(selectionKey);
  if (range) {
    const [from, to] = [
      keys.indexOf(selectionKey(anchor)),
      keys.indexOf(selectionKey(item)),
    ].toSorted((a, b) => a - b) as [number, number];
    return order.slice(from, to + 1);
  }
  const key = selectionKey(item);
  const base = treeItems(selection, item.kind as TreeKind);
  return base.some((s) => selectionKey(s) === key)
    ? base.filter((s) => selectionKey(s) !== key)
    : [...base, item];
}

function inOneStep(
  steps: ((projectId: string) => Promise<MutationResponse>)[],
): Promise<void> {
  const s = useStore.getState();
  const id = s.document?.id;
  if (!id || steps.length === 0) return Promise.resolve();
  return s.mutate(async () => {
    let last: MutationResponse | undefined;
    for (const step of steps) last = await step(id);
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

export async function deleteFeatures(ids: string[]) {
  await inOneStep(ids.map((fid) => (id) => api.deleteFeature(id, fid)));
  useStore.getState().setSelection([]);
}

const saveGroups = (groups: TreeGroup[]) =>
  inOneStep([(id) => api.updateGroups(id, groups)]);

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

export const selectSketchRegions = (sketchId: string) => {
  const s = useStore.getState();
  const sk = s.evaluation?.sketches.find((x) => x.featureId === sketchId);
  const profiles = sk?.profiles ?? [];
  const free = s.document
    ? freeProfileIds(sketchUsage(s.document), sketchId, profiles)
    : [];
  const ids = free.length > 0 ? free : profiles.map((p) => p.id);
  const sels: Selection[] = ids.map((id) => ({
    kind: "profile" as const,
    sketchId,
    profileId: id,
  }));
  s.setSelection(sels);
};
