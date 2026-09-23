import { expect, it, vi } from "vitest";
import type { BodyPayload, Feature } from "@rockett/shared";
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

const cut = { type: "extrude", operation: "cut" } as Feature;

function reshape(body: BodyPayload, face: number, dz: number): BodyPayload {
  const { start, count } = body.faces[face]!;
  const positions = [...body.positions];
  for (const i of new Set(body.indices.slice(start, start + count)))
    positions[i * 3 + 2]! += dz;
  return { ...body, meshKey: `${body.meshKey}~${face}`, positions };
}

function withNewFace(body: BodyPayload): BodyPayload {
  const base = body.positions.length / 3;
  const start = body.indices.length;
  return {
    ...body,
    meshKey: `${body.meshKey}+fillet`,
    positions: [...body.positions, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [...body.normals, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [...body.indices, base, base + 1, base + 2],
    faces: [
      ...body.faces,
      { ...body.faces[0]!, name: "f:fillet", start, count: 3 },
    ],
  };
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

it("leaves a body untinted while its mesh key matches the baseline", () => {
  const [kept] = manyBodyPayloads(1, 1);
  const moved = { ...reshape(kept!, 1, 1), meshKey: kept!.meshKey };
  expect(previewTints(cut, [kept!], roundTrip([moved]))).toEqual(new Map());
});

it("tints every face of a new body", () => {
  const [kept, added] = manyBodyPayloads(2, 1);
  expect(previewTints(cut, [kept!], roundTrip([kept!, added!]))).toEqual(
    new Map([
      [
        added!.bodyId,
        {
          tint: "preview-cut",
          ranges: [{ start: 0, count: added!.indices.length }],
        },
      ],
    ]),
  );
});

it("tints only the new faces when a feature adds faces and trims others", () => {
  const [body] = manyBodyPayloads(1, 1);
  const filleted = withNewFace(reshape(body!, 1, -0.5));
  const fillet = filleted.faces.at(-1)!;
  expect(previewTints(cut, [body!], roundTrip([filleted]))).toEqual(
    new Map([
      [
        body!.bodyId,
        {
          tint: "preview-cut",
          ranges: [{ start: fillet.start, count: fillet.count }],
        },
      ],
    ]),
  );
});

it("tints the moved faces when a changed body keeps every face name", () => {
  const [body] = manyBodyPayloads(1, 1);
  const join = { type: "extrude", operation: "join" } as Feature;
  const edited = reshape(body!, 1, 2);
  const cap = edited.faces[1]!;
  expect(previewTints(join, [body!], roundTrip([edited]))).toEqual(
    new Map([
      [
        body!.bodyId,
        {
          tint: "preview-add",
          ranges: [{ start: cap.start, count: cap.count }],
        },
      ],
    ]),
  );
});
