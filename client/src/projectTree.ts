import type { Folder, FolderTree, ProjectSummary } from "@rockett/shared";

export interface Item {
  kind: "folder" | "project";
  id: string;
  name: string;
  inBrowser?: true;
}

export const THIS_BROWSER = "browser";

export const EMPTY_TREE: FolderTree = { folders: [], placement: {} };

const byName = (a: Folder, b: Folder) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

const find = (tree: FolderTree, id: string | null) =>
  tree.folders.find((f) => f.id === id);

export function folderOf(tree: FolderTree, projectId: string): string | null {
  const id = tree.placement[projectId];
  return id !== undefined && find(tree, id) ? id : null;
}

export function subfolders(tree: FolderTree, id: string | null): Folder[] {
  return tree.folders.filter((f) => f.parentId === id).toSorted(byName);
}

export function projectsIn(
  tree: FolderTree,
  projects: ProjectSummary[],
  id: string | null,
): ProjectSummary[] {
  return projects.filter((p) => folderOf(tree, p.id) === id);
}

export function itemCount(
  tree: FolderTree,
  projects: ProjectSummary[],
  id: string,
): number {
  return subfolders(tree, id).length + projectsIn(tree, projects, id).length;
}

export function trail(tree: FolderTree, id: string | null): Folder[] {
  const out: Folder[] = [];
  for (
    let f = find(tree, id);
    f && out.length < tree.folders.length;
    f = find(tree, f.parentId)
  )
    out.unshift(f);
  return out;
}

export function parentOf(tree: FolderTree, item: Item): string | null {
  if (item.inBrowser) return THIS_BROWSER;
  return item.kind === "project"
    ? folderOf(tree, item.id)
    : (find(tree, item.id)?.parentId ?? null);
}

function isInside(tree: FolderTree, id: string | null, folderId: string) {
  return trail(tree, id).some((f) => f.id === folderId);
}

export function canMoveTo(
  tree: FolderTree,
  item: Item,
  target: string | null,
): boolean {
  if (target === parentOf(tree, item)) return false;
  if (target === THIS_BROWSER) return item.kind === "project";
  return item.kind === "project" || !isInside(tree, target, item.id);
}
