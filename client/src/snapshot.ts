import { THUMBNAIL_LIMITS } from "@rockett/shared";
import { api } from "./api";
import { browserKeyFromPath, isBrowserPath, projectIdFromPath } from "./paths";
import { useStore } from "./store";
import { TIMING_MS } from "./tunables";

interface Source {
  snapshot: (width: number, height: number) => HTMLCanvasElement | null;
}

const { width, height, bytes } = THUMBNAIL_LIMITS;

function capture(source: Source, projectId: string): void {
  source.snapshot(width, height)?.toBlob((png) => {
    if (!png || png.size > bytes) return;
    api
      .putThumbnail(projectId, png)
      .catch((e: Error) =>
        useStore.setState({ error: `Snapshot not saved: ${e.message}` }),
      );
  }, "image/png");
}

const onServerList = (path: string) =>
  projectIdFromPath(path) === null &&
  browserKeyFromPath(path) === null &&
  !isBrowserPath(path);

export function watchSnapshots(source: Source): () => void {
  let captured = -Infinity;
  return useStore.subscribe((s, prev) => {
    const path = window.location.pathname;
    if (s.projectId !== prev.projectId) {
      captured = -Infinity;
      if (
        prev.projectId !== null &&
        prev.access === "edit" &&
        s.projectId === null &&
        onServerList(path)
      )
        capture(source, prev.projectId);
      return;
    }
    const { projectId, savedAt } = s;
    if (projectId === null || s.access !== "edit") return;
    if (savedAt === null || savedAt === prev.savedAt) return;
    if (browserKeyFromPath(path) !== null) return;
    if (savedAt - captured < TIMING_MS.snapshotInterval) return;
    captured = savedAt;
    setTimeout(() => {
      if (useStore.getState().projectId === projectId)
        capture(source, projectId);
    });
  });
}
