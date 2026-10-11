import type { Feature } from "@rockett/shared";
import {
  cloneState,
  Recorder,
  RecordedMap,
  type EvalState,
  type FeatureOutcome,
  type ReadMap,
  type StateMap,
} from "./featureState.js";
import type { Sources } from "./importers.js";

type Seen =
  | { all: ReadonlyMap<string, unknown> }
  | { keys: ReadonlyMap<string, unknown> };

export interface Deps {
  seen: Map<ReadMap, Seen>;
  writes: Recorder["writes"];
  outcome: FeatureOutcome | void;
  blocked: ReadonlySet<string>;
  hidden?: ReadonlySet<string>;
}

const STATE_MAPS: StateMap[] = ["bodies", "sketches", "planes", "imported"];
const READ_MAPS: ReadMap[] = [...STATE_MAPS, "sources"];

const inputsOf = (
  state: EvalState,
  sources: Sources,
): Record<ReadMap, ReadonlyMap<string, unknown>> => ({
  bodies: state.bodies,
  sketches: state.sketches,
  planes: state.planes,
  imported: state.imported,
  sources,
});

function sameEntries(
  a: ReadonlyMap<unknown, unknown>,
  b: ReadonlyMap<unknown, unknown>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  const other = b.entries();
  for (const [key, value] of a) {
    const next = other.next().value;
    if (!next || next[0] !== key || next[1] !== value) return false;
  }
  return true;
}

const sameSet = (a?: ReadonlySet<string>, b?: ReadonlySet<string>) =>
  a === b || (!!a && !!b && a.size === b.size && [...a].every((x) => b.has(x)));

export function replayed(
  state: EvalState,
  after: EvalState,
  writes: Recorder["writes"],
): EvalState {
  const next = { ...state, ...cloneState(state) };
  for (const [map, op, key] of writes) {
    const target = next[map] as Map<string, unknown>;
    if (op === "delete") target.delete(key);
    else target.set(key, after[map].get(key));
  }
  return next;
}

function depsOf(
  recorder: Recorder,
  state: EvalState,
  after: EvalState,
  sources: Sources,
  outcome: FeatureOutcome | void,
): Deps | undefined {
  if (recorder.earlier) return;
  const replay = replayed(state, after, recorder.writes);
  if (
    replay.blocked !== after.blocked ||
    replay.hidden !== after.hidden ||
    !STATE_MAPS.every((map) => sameEntries(replay[map], after[map]))
  )
    return;
  const inputs = inputsOf(state, sources);
  const seen = new Map<ReadMap, Seen>();
  for (const map of READ_MAPS) {
    const read = recorder.read.get(map);
    if (read === "all") {
      seen.set(map, { all: new Map(inputs[map]) });
      continue;
    }
    const keys = new Set(read);
    for (const [written, , key] of recorder.writes)
      if (written === map) keys.add(key);
    seen.set(map, {
      keys: new Map([...keys].map((key) => [key, inputs[map].get(key)])),
    });
  }
  return {
    seen,
    writes: recorder.writes,
    outcome,
    blocked: state.blocked,
    ...(state.hidden && { hidden: state.hidden }),
  };
}

function holds(
  { seen, blocked, hidden }: Deps,
  state: EvalState,
  sources: Sources,
): boolean {
  if (!sameSet(blocked, state.blocked) || !sameSet(hidden, state.hidden))
    return false;
  const inputs = inputsOf(state, sources);
  return READ_MAPS.every((map) => {
    const found = seen.get(map)!;
    const now = inputs[map];
    return "all" in found
      ? sameEntries(found.all, now)
      : [...found.keys].every(([key, value]) => now.get(key) === value);
  });
}

function recording(state: EvalState, recorder: Recorder) {
  return {
    bodies: new RecordedMap(recorder, "bodies", state.bodies),
    sketches: new RecordedMap(recorder, "sketches", state.sketches),
    planes: new RecordedMap(recorder, "planes", state.planes),
    imported: new RecordedMap(recorder, "imported", state.imported),
  };
}

function watched<T extends object>(target: T, recorder: Recorder): T {
  const read = () => {
    if (recorder.on) recorder.earlier = true;
  };
  return new Proxy(target, {
    get(t, p, r) {
      if (p !== "length") read();
      return Reflect.get(t, p, r);
    },
    has(t, p) {
      read();
      return Reflect.has(t, p);
    },
    ownKeys(t) {
      read();
      return Reflect.ownKeys(t);
    },
  });
}

export function recorded(
  state: EvalState,
  next: EvalState,
  earlier: Feature[],
  sources: Sources,
  run: (earlier: Feature[], sources: Sources) => FeatureOutcome | void,
): { outcome: FeatureOutcome | void; deps?: Deps } {
  const recorder = new Recorder();
  Object.assign(next, recording(state, recorder));
  let outcome: FeatureOutcome | void;
  try {
    outcome = run(
      watched(earlier, recorder),
      new RecordedMap(recorder, "sources", sources),
    );
  } finally {
    recorder.on = false;
  }
  const deps = depsOf(recorder, state, next, sources, outcome);
  return { outcome, ...(deps && { deps }) };
}

interface Kept {
  featureKeys: string[];
  deps?: Deps;
}

export function reusable(
  old: Kept | undefined,
  key: string,
  state: EvalState,
  sources: Sources,
): Deps | undefined {
  return old?.deps &&
    old.featureKeys.includes(key) &&
    holds(old.deps, state, sources)
    ? old.deps
    : undefined;
}

export function retired<S>(
  stale: Map<number, S>,
  dropped: S[],
  valid: number,
  count: number,
  sameNaming: boolean,
): S[] {
  const discarded: S[] = [];
  if (!sameNaming) {
    discarded.push(...stale.values(), ...dropped);
    stale.clear();
  } else
    dropped.forEach((snapshot, k) => {
      const older = stale.get(valid + k);
      if (older) discarded.push(older);
      stale.set(valid + k, snapshot);
    });
  for (const [at, snapshot] of stale)
    if (at < valid || at >= count) {
      discarded.push(snapshot);
      stale.delete(at);
    }
  return discarded;
}
