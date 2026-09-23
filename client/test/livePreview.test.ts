import { expect, it, vi } from "vitest";
import type { Feature } from "@rockett/shared";
import {
  createLivePreview,
  PREVIEW_DWELL_MS,
  previewTints,
} from "../src/livePreview";
import { manyBodyPayloads } from "./helpers/perfFixtures";

function setup() {
  let clock = 0;
  let settle: (() => void) | undefined;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const live = createLivePreview({ intervalMs: 250, send, now: () => clock });
  return {
    live,
    send,
    at: (t: number) => {
      clock = t;
    },
    settle: async () => {
      settle?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

it("sends once for ten calls inside the interval", async () => {
  const { live, send, at, settle } = setup();
  for (let i = 0; i < 10; i++) {
    at(i * 25);
    live.during("f", { distance: i } as any);
    if (i === 0) await settle();
  }
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith("f", { distance: 0 });
});

it("drops a call while a send is in flight", async () => {
  const { live, send, at, settle } = setup();
  live.during("f", { distance: 1 } as any);
  at(1000);
  live.during("f", { distance: 2 } as any);
  expect(send).toHaveBeenCalledTimes(1);
  await settle();
  at(2000);
  live.during("f", { distance: 3 } as any);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith("f", { distance: 3 });
});

it("commit always sends the last patch", () => {
  const { live, send } = setup();
  live.during("f", { distance: 1 } as any);
  live.during("f", { distance: 2 } as any);
  live.commit("f", { distance: 3 } as any);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith("f", { distance: 3 });
});

it("sends one dwell preview with the last of five quick inputs", () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => {});
  const live = createLivePreview({ send });
  for (let i = 1; i <= 5; i++) {
    live.dwell("f", { distance: i } as any);
    vi.advanceTimersByTime(PREVIEW_DWELL_MS - 1);
  }
  expect(send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith("f", { distance: 5 });
  vi.useRealTimers();
});

it("cancel and commit drop a pending dwell", () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => {});
  const live = createLivePreview({ send });
  live.dwell("f", { distance: 1 } as any);
  live.cancel();
  live.dwell("f", { distance: 2 } as any);
  live.commit("f", { distance: 3 } as any);
  vi.advanceTimersByTime(PREVIEW_DWELL_MS * 2);
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith("f", { distance: 3 });
  vi.useRealTimers();
});

it("tints a preview body only when its mesh key differs from the baseline", () => {
  const [kept, moved, added] = manyBodyPayloads(3, 1);
  const cut = { type: "extrude", operation: "cut" } as Feature;
  const after = JSON.parse(
    JSON.stringify([kept, { ...moved, meshKey: "moved" }, added]),
  );
  expect(previewTints(cut, [kept!, moved!], after)).toEqual(
    new Map([
      [moved!.bodyId, "preview-cut"],
      [added!.bodyId, "preview-cut"],
    ]),
  );
});
