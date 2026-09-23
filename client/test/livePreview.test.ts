import { expect, it, vi } from "vitest";
import { createLivePreview } from "../src/livePreview";

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
