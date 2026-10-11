import type { Loop } from "./geometry";

const MOTIONS = [
  "cut",
  "linkClear",
  "linkNotClear",
  "linkClearAtPrevPass",
] as const;
const OPERATIONS = [
  "clearingInside",
  "clearingOutside",
  "profilingInside",
  "profilingOutside",
] as const;
const WARNINGS = [
  "startPointNotFound",
  "leadPathFailed",
  "unexpectedRotateIterations",
  "tooManyFailedEngagements",
  "unclearedAreaRemains",
  "failedToSetUpFinishingPass",
  "finishingLeadInFailed",
] as const;

export type AdaptiveMotion = (typeof MOTIONS)[number];
export type AdaptiveOperation = (typeof OPERATIONS)[number];
export type AdaptiveWarning = (typeof WARNINGS)[number];
type Point = { x: number; y: number };

export type AdaptiveInput = {
  stock: Loop[];
  region: Loop[];
  cleared: Loop[];
  operation: AdaptiveOperation;
  toolDiameter: number;
  stepOverFactor: number;
  tolerance: number;
  stockToLeave: number;
  helixRampTargetDiameter: number;
  helixRampMinDiameter: number;
  forceInsideOut: boolean;
  finishingProfile: boolean;
  keepToolDownDistRatio: number;
};

export type AdaptiveRegion = {
  helixCentre: Point;
  start: Point;
  returnMotion: AdaptiveMotion;
  clearedArea: number;
  warnings: AdaptiveWarning[];
  paths: { motion: AdaptiveMotion; points: Point[] }[];
};

type Engine = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(bytes: bigint): bigint;
  adaptive(input: bigint): bigint;
};

const UNSUPPORTED = () => 52;
const IMPORTS = {
  env: { emscripten_notify_memory_growth: () => undefined },
  wasi_snapshot_preview1: Object.fromEntries(
    [
      "clock_time_get",
      "fd_seek",
      "fd_write",
      "fd_read",
      "fd_close",
      "environ_sizes_get",
      "environ_get",
    ].map((name) => [name, UNSUPPORTED]),
  ),
};

function encode(input: AdaptiveInput): number[] {
  const values = [
    input.toolDiameter,
    input.helixRampTargetDiameter,
    input.helixRampMinDiameter,
    input.stepOverFactor,
    input.tolerance,
    input.stockToLeave,
    Number(input.forceInsideOut),
    Number(input.finishingProfile),
    input.keepToolDownDistRatio,
    OPERATIONS.indexOf(input.operation),
  ];
  for (const loops of [input.stock, input.region, input.cleared]) {
    values.push(loops.length);
    for (const loop of loops) {
      values.push(loop.length, ...loop.flatMap(({ x, y }) => [x, y]));
    }
  }
  if (!values.every(Number.isFinite)) {
    throw new RangeError("adaptive input has a number that is not finite");
  }
  if (input.toolDiameter <= 0 || input.stepOverFactor <= 0) {
    throw new RangeError("tool diameter and step over must be positive");
  }
  return values;
}

function outputError(): never {
  throw new Error("adaptive engine returned malformed output");
}

function span(memory: WebAssembly.Memory, pointer: bigint, length: number) {
  const address = Number(pointer);
  if (
    !Number.isSafeInteger(address) ||
    address < 0 ||
    address % 8 !== 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > (memory.buffer.byteLength - address) / 8
  ) {
    outputError();
  }
  return new Float64Array(memory.buffer, address, length);
}

function decode(values: Float64Array): AdaptiveRegion[] {
  let at = 1;
  const next = () => {
    const value = values[at++];
    if (value === undefined || !Number.isFinite(value)) outputError();
    return value;
  };
  const count = (width: number) => {
    const value = next();
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > (values.length - at) / width
    ) {
      outputError();
    }
    return value;
  };
  const point = () => ({ x: next(), y: next() });
  const motion = () => {
    const code = next();
    const found = MOTIONS[code];
    if (!Number.isInteger(code) || !found) outputError();
    return found;
  };
  const regions: AdaptiveRegion[] = [];
  const regionCount = count(8);
  for (let i = 0; i < regionCount; i++) {
    const helixCentre = point();
    const start = point();
    const returnMotion = motion();
    const clearedArea = next();
    const flags = next();
    if (
      !Number.isInteger(flags) ||
      flags < 0 ||
      flags >= 2 ** WARNINGS.length
    ) {
      outputError();
    }
    const warnings = WARNINGS.filter((_, bit) => flags & (1 << bit));
    const paths: AdaptiveRegion["paths"] = [];
    const pathCount = count(2);
    for (let j = 0; j < pathCount; j++) {
      const pathMotion = motion();
      const pointCount = count(2);
      const points: Point[] = [];
      for (let k = 0; k < pointCount; k++) points.push(point());
      paths.push({ motion: pathMotion, points });
    }
    regions.push({
      helixCentre,
      start,
      returnMotion,
      clearedArea,
      warnings,
      paths,
    });
  }
  if (at !== values.length) outputError();
  return regions;
}

export function adaptiveClear(
  engine: WebAssembly.Module,
  input: AdaptiveInput,
): AdaptiveRegion[] {
  const values = encode(input);
  const wasm = new WebAssembly.Instance(engine, IMPORTS)
    .exports as unknown as Engine;
  wasm["_initialize"]();
  const address = wasm.malloc(BigInt(values.length * 8));
  span(wasm.memory, address, values.length).set(values);
  const result = wasm.adaptive(address);
  const length = span(wasm.memory, result, 1)[0]!;
  if (length < 2) outputError();
  return decode(span(wasm.memory, result, length));
}
