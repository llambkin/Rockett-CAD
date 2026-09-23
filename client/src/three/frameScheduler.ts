export interface FrameSource {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const browserFrames: FrameSource = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface FrameScheduler {
  requestRender(): void;
  onRender(listener: () => void): () => void;
  dispose(): void;
}

export function frameScheduler(
  draw: (now: number) => boolean,
  frames: FrameSource = browserFrames,
): FrameScheduler {
  const listeners = new Set<() => void>();
  let pending: number | null = null;
  let live = true;
  const requestRender = () => {
    if (live) pending ??= frames.request(tick);
  };
  const tick = (now: number) => {
    pending = null;
    const animating = draw(now);
    for (const listener of listeners) listener();
    if (animating) requestRender();
  };
  return {
    requestRender,
    onRender(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      live = false;
      if (pending !== null) frames.cancel(pending);
      pending = null;
      listeners.clear();
    },
  };
}
