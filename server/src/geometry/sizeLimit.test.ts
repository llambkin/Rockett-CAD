import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  SIZE_KEYS,
  type LinearPatternFeature,
  type ShellFeature,
} from "@rockett/shared";
import { TIMING_MS, TRIAL_BUDGET } from "../tunables.js";
import { trialBuild } from "./engine.js";
import { emptyState, NoCorner } from "./features.js";
import { NameMap } from "./naming.js";
import { sizeLimit } from "./sizeLimit.js";

vi.mock("./engine.js", () => ({ trialBuild: vi.fn() }));
vi.mock("./kernel.js", async (original) => ({
  ...(await original<typeof import("./kernel.js")>()),
  volumeOf: (shape: { volume?: number }) => shape.volume ?? 4,
  areaOf: () => 1,
  bboxOf: () => ({ min: [0, 0, 0], max: [3, 4, 0] }),
}));

const feature: ShellFeature = {
  id: "shell",
  name: "Shell",
  type: "shell",
  suppressed: false,
  openFaces: [],
  direction: "inside",
  thickness: 1,
};
const doc = createEmptyDocument("limit", "Limit");
const trials: { size: number; passed: boolean }[] = [];
let clock = 0;

function state() {
  const result = emptyState();
  result.bodies.set("body", {
    bodyId: "body",
    shape: {},
    names: new NameMap(2),
  });
  return result;
}

function accept(check: (size: number, trial: number) => boolean) {
  vi.mocked(trialBuild).mockImplementation((_state, sized) => {
    const size = Reflect.get(sized, SIZE_KEYS[sized.type as "shell"]);
    const passed = check(size, trials.length + 1);
    trials.push({ size, passed });
    if (!passed) throw new Error("size does not fit");
    return true;
  });
}

beforeEach(() => {
  clock = 0;
  trials.length = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.mocked(trialBuild).mockReset();
});
afterEach(() => vi.restoreAllMocks());

it.each(["no failing trial", "wide bracket"])(
  "trial exhaustion with %s keeps the last fit unresolved",
  async (scenario) => {
    accept((_size, trial) =>
      scenario === "no failing trial"
        ? true
        : trial < TRIAL_BUDGET.sizeLimitBuilds,
    );
    const found = await sizeLimit(state(), doc, undefined, feature);
    expect(trials).toHaveLength(TRIAL_BUDGET.sizeLimitBuilds);
    expect(found).toEqual({
      kind: "stopped",
      size: trials.findLast((trial) => trial.passed)!.size,
      builds: TRIAL_BUDGET.sizeLimitBuilds,
    });
  },
);

it("trial exhaustion without a fit preserves the smallest failure unresolved", async () => {
  accept(() => false);
  expect(await sizeLimit(state(), doc, undefined, feature)).toEqual({
    kind: "stopped",
    below: 12 / 4 ** (TRIAL_BUDGET.sizeLimitBuilds - 1),
    builds: TRIAL_BUDGET.sizeLimitBuilds,
  });
});

it.each([true, false])(
  "deadline exhaustion preserves a completed passing=%s trial unresolved",
  async (passed) => {
    accept(() => {
      clock = TIMING_MS.sizeLimitSearch + 1;
      return passed;
    });
    expect(await sizeLimit(state(), doc, undefined, feature)).toEqual(
      passed
        ? { kind: "stopped", size: 12, builds: 1 }
        : { kind: "slow", builds: 1 },
    );
  },
);

it("only claims a bound backed by a failing upper trial", async () => {
  accept((size) => size <= 2);
  const found = await sizeLimit(state(), doc, undefined, feature);
  expect(found.kind).toBe("upTo");
  if (found.kind !== "upTo") throw new Error("missing bracket");
  const passing = trials.filter((trial) => trial.passed);
  const failing = trials.filter((trial) => !trial.passed);
  expect(found.size).toBe(passing.at(-1)!.size);
  expect(found.size).toBeLessThanOrEqual(2);
  expect(found.size * 1.25).toBeGreaterThan(2);
  expect(Math.min(...failing.map((trial) => trial.size))).toBeLessThanOrEqual(
    found.size * 1.25,
  );
  expect(found.builds).toBe(trials.length);
});

it("preserves the no-corner refusal instead of treating it as a failed size", async () => {
  vi.mocked(trialBuild).mockImplementation(() => {
    throw new Error("fillet", { cause: new NoCorner() });
  });
  expect(await sizeLimit(state(), doc, undefined, feature)).toEqual({
    kind: "smooth",
    builds: 1,
  });
});

it("a resumed state's wait does not consume the search deadline", async () => {
  const original = state();
  const recovered = state();
  const resume = vi.fn(async () => {
    clock += TIMING_MS.sizeLimitSearch * 2;
    return recovered;
  });
  accept((size) => size <= 2);
  const found = await sizeLimit(original, doc, undefined, feature, resume);
  expect(found.kind).toBe("upTo");
  expect(resume).toHaveBeenCalledTimes(found.builds - 1);
  expect(vi.mocked(trialBuild).mock.calls[0]![0]).toBe(original);
  expect(
    vi
      .mocked(trialBuild)
      .mock.calls.slice(1)
      .map((call) => call[0]),
  ).toEqual(Array.from({ length: found.builds - 1 }, () => recovered));
});

it("a closed shell sizes the chosen body, not the first", async () => {
  accept(() => true);
  const two = state();
  two.bodies.set("chosen", {
    bodyId: "chosen",
    shape: { volume: 8 },
    names: new NameMap(2),
  });
  await sizeLimit(two, doc, undefined, { ...feature, body: "chosen" });
  expect(trials[0]!.size).toBe(24);
});

it("a closed shell refuses a chosen body that is gone without a trial", async () => {
  accept(() => true);
  await expect(
    sizeLimit(state(), doc, undefined, { ...feature, body: "gone" }),
  ).rejects.toThrow("no body to shell");
  expect(trialBuild).not.toHaveBeenCalled();
});

const pattern: LinearPatternFeature = {
  id: "pattern",
  name: "Pattern",
  type: "linearPattern",
  suppressed: false,
  bodies: ["body"],
  direction: { kind: "axis", axis: "X" },
  count: 3,
  spacing: -1,
  combine: false,
};

it("a least-size input searches down from its estimate and keeps the typed side", async () => {
  accept((size) => size <= -2);
  const found = await sizeLimit(state(), doc, undefined, pattern);
  expect(trials[0]!.size).toBe(-5);
  expect(found.kind).toBe("upTo");
  if (found.kind !== "upTo") throw new Error("missing bracket");
  expect(found.size).toBe(-trials.findLast((trial) => trial.passed)!.size);
  expect(found.size).toBeGreaterThanOrEqual(2);
  expect(found.size / 1.25).toBeLessThan(2);
  expect(
    Math.max(...trials.filter((t) => !t.passed).map((t) => -t.size)),
  ).toBeGreaterThanOrEqual(found.size / 1.25);
});

it("a least-size input that fails everywhere reports its largest failure", async () => {
  accept(() => false);
  expect(await sizeLimit(state(), doc, undefined, pattern)).toEqual({
    kind: "stopped",
    below: 5 * 4 ** (TRIAL_BUDGET.sizeLimitBuilds - 1),
    builds: TRIAL_BUDGET.sizeLimitBuilds,
  });
});
