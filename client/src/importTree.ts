import type { FeatureStatus, ImportNode, TreeGroup } from "@rockett/shared";
import type { Selection } from "./store";
import { bodySel } from "./treeSelection";

export interface TreePart<T> {
  group: TreeGroup | null;
  items: T[];
  parts?: TreePart<T>[];
}

const visible = <T>(
  parts: TreePart<T>[],
  collapsed: Record<string, boolean>,
): T[] =>
  parts.flatMap((part) =>
    part.group && collapsed[part.group.id]
      ? []
      : [...visible(part.parts ?? [], collapsed), ...part.items],
  );

export function importParts<T extends { bodyId: string }>(
  { parts }: { parts: TreePart<T>[] },
  statuses: readonly FeatureStatus[],
  collapsed: Record<string, boolean>,
): { parts: TreePart<T>[]; order: Selection[] } {
  const loose = parts.find((part) => !part.group)?.items ?? [];
  const free = new Map(loose.map((item) => [item.bodyId, item]));
  const take = (ids: string[]) =>
    ids.flatMap((id) => {
      const item = free.get(id);
      free.delete(id);
      return item ? [item] : [];
    });
  const component = (featureId: string, node: ImportNode): TreePart<T>[] => {
    if (node.children.length === 0) return [];
    const inner = node.children.flatMap((child) => component(featureId, child));
    const items = take(
      node.children.flatMap((child) =>
        child.children.length ? [] : child.bodyIds,
      ),
    );
    if (inner.length + items.length === 0) return [];
    const members = [
      ...inner.flatMap((part) => part.group!.members),
      ...items.map((item) => item.bodyId),
    ];
    const id = `import:${featureId}:${node.path.join("/")}`;
    const name = node.name ?? "Component";
    return [
      { group: { id, name, kind: "body", members }, items, parts: inner },
    ];
  };
  const components = statuses.flatMap(({ featureId, importTree }) =>
    (importTree ?? []).flatMap((root) => component(featureId, root)),
  );
  const all = [
    ...parts.filter((part) => part.group),
    ...components,
    { group: null, items: loose.filter((item) => free.has(item.bodyId)) },
  ];
  return { parts: all, order: visible(all, collapsed).map(bodySel) };
}
