export function projectPath(id: string): string {
  return `/projects/${encodeURIComponent(id)}`;
}

export function folderPath(id: string | null): string {
  return id === null ? "/" : `/folders/${encodeURIComponent(id)}`;
}

function idFromPath(kind: string, path: string): string | null {
  const segment = new RegExp(`^/${kind}/([^/]+)/?$`).exec(path)?.[1];
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export const projectIdFromPath = (path: string) => idFromPath("projects", path);
export const folderIdFromPath = (path: string) => idFromPath("folders", path);

export function showPath(path: string): void {
  if (window.location.pathname !== path)
    window.history.pushState(null, "", path);
}
