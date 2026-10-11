import { describe, expect, it } from "vitest";
import {
  adaptiveClear,
  type AdaptiveInput,
} from "../src/toolpath/adaptiveEngine";

function leb(value: bigint): number[] {
  const bytes: number[] = [];
  for (;;) {
    const byte = Number(value & 127n);
    value >>= 7n;
    const done =
      (value === 0n && !(byte & 64)) || (value === -1n && !!(byte & 64));
    bytes.push(byte | (done ? 0 : 128));
    if (done) return bytes;
  }
}

const section = (id: number, bytes: number[]) => [
  id,
  ...leb(BigInt(bytes.length)),
  ...bytes,
];
const name = (text: string) => [text.length, ...new TextEncoder().encode(text)];
const body = (bytes: number[]) => [bytes.length + 2, 0, ...bytes, 11];

function producer(values: number[], pointer = 8192n, allocation = 1024n) {
  const data = [...new Uint8Array(new Float64Array(values).buffer)];
  return new WebAssembly.Module(
    new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      ...section(1, [2, 96, 0, 0, 96, 1, 126, 1, 126]),
      ...section(3, [3, 0, 1, 1]),
      ...section(5, [1, 0, 1]),
      ...section(7, [
        4,
        ...name("memory"),
        2,
        0,
        ...name("_initialize"),
        0,
        0,
        ...name("malloc"),
        0,
        1,
        ...name("adaptive"),
        0,
        2,
      ]),
      ...section(10, [
        3,
        ...body([]),
        ...body([66, ...leb(allocation)]),
        ...body([66, ...leb(pointer)]),
      ]),
      ...section(11, [
        1,
        0,
        65,
        ...leb(8192n),
        11,
        ...leb(BigInt(data.length)),
        ...data,
      ]),
    ]),
  );
}

const input: AdaptiveInput = {
  stock: [],
  region: [],
  cleared: [],
  operation: "clearingInside",
  toolDiameter: 10,
  stepOverFactor: 0.2,
  tolerance: 0.1,
  stockToLeave: 0,
  helixRampTargetDiameter: 0,
  helixRampMinDiameter: 0,
  forceInsideOut: true,
  finishingProfile: true,
  keepToolDownDistRatio: 3,
};
const region = [10, 1, 2, 3, 4, 5, 0, 6, 0, 0];
const path = [14, 1, 2, 3, 4, 5, 0, 6, 0, 1, 0, 1, 7, 8];

describe("adaptive output boundary", () => {
  it("accepts empty output and all defined warning bits", () => {
    expect(adaptiveClear(producer([2, 0]), input)).toEqual([]);
    const values = [...region];
    values[8] = 127;
    expect(adaptiveClear(producer(values), input)).toEqual([
      {
        helixCentre: { x: 2, y: 3 },
        start: { x: 4, y: 5 },
        returnMotion: "cut",
        clearedArea: 6,
        warnings: [
          "startPointNotFound",
          "leadPathFailed",
          "unexpectedRotateIterations",
          "tooManyFailedEngagements",
          "unclearedAreaRemains",
          "failedToSetUpFinishingPass",
          "finishingLeadInFailed",
        ],
        paths: [],
      },
    ]);
  });

  it("preserves exact valid geometry and motion codes", () => {
    const values = [...path];
    values[6] = 3;
    values[10] = 2;
    expect(adaptiveClear(producer(values), input)).toEqual([
      {
        helixCentre: { x: 2, y: 3 },
        start: { x: 4, y: 5 },
        returnMotion: "linkClearAtPrevPass",
        clearedArea: 6,
        warnings: [],
        paths: [{ motion: "linkNotClear", points: [{ x: 7, y: 8 }] }],
      },
    ]);
  });

  it.each([
    [1],
    [2, -1],
    [12, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1],
    [3, 0, 99],
    [2, 1],
    [2, 0.5],
    [2, Infinity],
    [2, NaN],
    [2, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects malformed vector %j", (...values) => {
    expect(() => adaptiveClear(producer(values), input)).toThrow(
      /adaptive engine/,
    );
  });

  it.each([1, 9, 11])("rejects invalid nested count at %i", (index) => {
    for (const count of [
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      100,
    ]) {
      const values = [...path];
      values[index] = count;
      expect(() => adaptiveClear(producer(values), input)).toThrow(
        /adaptive engine/,
      );
    }
  });

  it.each([2, 3, 4, 5, 7, 12, 13])(
    "rejects nonfinite geometry at %i",
    (index) => {
      for (const value of [NaN, Infinity, -Infinity]) {
        const values = [...path];
        values[index] = value;
        expect(() => adaptiveClear(producer(values), input)).toThrow(
          /adaptive engine/,
        );
      }
    },
  );

  it.each([6, 8, 10])("rejects unknown codes at %i", (index) => {
    for (const code of [-1, 0.5, NaN, Infinity, index === 8 ? 128 : 4]) {
      const values = [...path];
      values[index] = code;
      expect(() => adaptiveClear(producer(values), input)).toThrow(
        /adaptive engine/,
      );
    }
  });

  it.each([-8n, 8193n, 65536n, 9007199254740993n])(
    "rejects result pointer %s",
    (pointer) => {
      expect(() => adaptiveClear(producer([2, 0], pointer), input)).toThrow(
        /adaptive engine/,
      );
    },
  );

  it.each([0, 1, -1, 1.5, NaN, Infinity, 10000])(
    "rejects result length %s",
    (length) => {
      expect(() => adaptiveClear(producer([length, 0]), input)).toThrow(
        /adaptive engine/,
      );
    },
  );

  it.each([-8n, 1025n, 65528n, 9007199254740993n])(
    "rejects input allocation %s",
    (allocation) => {
      expect(() =>
        adaptiveClear(producer([2, 0], 8192n, allocation), input),
      ).toThrow(/adaptive engine/);
    },
  );

  it("refuses a malformed second region without returning the first", () => {
    const values = [19, 2, ...region.slice(2), ...region.slice(2, 9), 1, 0];
    expect(() => adaptiveClear(producer(values), input)).toThrow(
      /adaptive engine/,
    );
  });
});
