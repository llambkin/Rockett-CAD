import { THUMBNAIL_LIMITS } from "@rockett/shared";
import { api } from "./api";
import { browserKeyFromPath, projectIdFromPath } from "./paths";
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

export function watchSnapshots(source: Source): () => void {
  let edited: string | null = null;
  let captured = -Infinity;
  return useStore.subscribe((s, prev) => {
    const path = window.location.pathname;
    if (s.projectId !== prev.projectId) {
      const leaving = edited;
      edited = null;
      captured = -Infinity;
      if (
        leaving !== null &&
        leaving === prev.projectId &&
        s.projectId === null &&
        projectIdFromPath(path) === null
      )
        capture(source, leaving);
      return;
    }
    const { projectId, savedAt } = s;
    if (projectId === null || savedAt === null || savedAt === prev.savedAt)
      return;
    if (browserKeyFromPath(path) !== null) return;
    edited = projectId;
    if (savedAt - captured < TIMING_MS.snapshotInterval) return;
    captured = savedAt;
    setTimeout(() => {
      if (useStore.getState().projectId === projectId)
        capture(source, projectId);
    });
  });
}
