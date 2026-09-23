import { api, type MutationResponse } from "./api";
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

export const treeIds = (selection: Selection[], kind: "body" | "sketch") =>
  treeItems(selection, kind).flatMap((s) =>
    s.kind === "body" ? [s.bodyId] : s.kind === "sketch" ? [s.sketchId] : [],
  );

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

export const setBodiesVisible = (visible: Record<string, boolean>) => {
  const bodies = useStore.getState().evaluation?.bodies ?? [];
  return inOneStep(
    bodies
      .filter((b) => b.bodyId in visible && b.visible !== visible[b.bodyId])
      .map(
        (b) => (id) =>
          api.updateBody(id, b.bodyId, { visible: visible[b.bodyId]! }),
      ),
  );
};

export const setSketchesVisible = (ids: string[], visible: boolean) =>
  inOneStep(ids.map((fid) => (id) => api.updateFeature(id, fid, { visible })));

export async function deleteFeatures(ids: string[]) {
  await inOneStep(ids.map((fid) => (id) => api.deleteFeature(id, fid)));
  useStore.getState().setSelection([]);
}
