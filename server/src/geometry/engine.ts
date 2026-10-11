import {
  autoTargetsAt,
  lazyMesh,
  resolveDocumentParameters,
} from "@rockett/shared";
import type {
  CadDocument,
  ConstructionPlanePayload,
  ExtrudeFeature,
  FeatureStatus,
  MeshedBody,
  MeshedEvaluation,
  NamingVersion,
  SketchPayload,
} from "@rockett/shared";
import {
  cloneState,
  emptyState,
  evaluateFeature,
  type EvalState,
  type FeatureOutcome,
  type StateBody,
} from "./features.js";
import {
  recorded,
  replayed,
  retired,
  reusable,
  type Deps,
} from "./featureDeps.js";
import "./kinds.js";
import type { Sources } from "./importers.js";
import { movePayload, tessellateBody } from "./tessellate.js";
import { withNamingVersion } from "./naming.js";
import { bodyLabel } from "./featureState.js";
import { modifiedFaces } from "./modified.js";
import { heldParts } from "./meshBody.js";
import { cancellable, release } from "./kernel.js";
import { heapBytes, lruEngines } from "./engineCache.js";
import {
  cached,
  forget,
  payloadBytes,
  sourceOf,
  sourceMesh,
  store,
  tessCache,
  type Decoded,
} from "./tessellationCache.js";
import {
  BlockedFeature,
  blockedFeatureIds,
  blockedBodies,
  crashStatus,
  evaluateResolved,
  unresolvedRefs,
  type CrashFeature,
} from "./resolve.js";
import {
  checkedFeatureInputs,
  featureKey,
  featureKeys,
} from "../modules/featureInputs.js";

export { featureKey } from "../modules/featureInputs.js";

interface Snapshot {
  featureKeys: string[];
  state: EvalState;
  statuses: FeatureStatus[];
  deps?: Deps;
}

function okStatus(
  feature: CadDocument["features"][number],
  outcome: FeatureOutcome | void,
  before: EvalState,
  after: EvalState,
): FeatureStatus {
  const modified = modifiedFaces(before.bodies, after.bodies);
  return {
    featureId: feature.id,
    status: outcome?.warning ? "warning" : "ok",
    ...outcome,
    ...(modified && { modified }),
  };
}

const snapshotBodies = (snapshots: Pick<Snapshot, "state">[]) =>
  snapshots.flatMap((snapshot) => [...snapshot.state.bodies.values()]);

function releaseSnapshots(
  discarded: Pick<Snapshot, "state">[],
  retained: Pick<Snapshot, "state">[],
): void {
  const kept = snapshotBodies(retained);
  const keptSources = new Set(kept.map(sourceOf));
  const keptParts = kept.flatMap(heldParts);
  const keptShapes = new Set(keptParts.map((part) => part.shape));
  const keptNames = new Set(keptParts.map((part) => part.names));
  const dropped = snapshotBodies(discarded);
  const freed = dropped.filter((b) => !keptSources.has(sourceOf(b)));
  freed.forEach(forget);
  const names = new Set(dropped.flatMap(heldParts).map((part) => part.names));
  const shapes = freed.flatMap(heldParts).map((part) => part.shape);
  release([
    ...[...names]
      .filter((bodyNames) => !keptNames.has(bodyNames))
      .toReversed()
      .map((bodyNames) => ({ delete: () => bodyNames.release() })),
    ...new Set(shapes.filter((shape) => !keptShapes.has(shape))),
  ]);
}

function evaluateTracked(
  next: EvalState,
  feature: CadDocument["features"][number],
  earlier: CadDocument["features"],
  sources: Sources,
  namingVersion: NamingVersion,
  shouldStop?: () => boolean,
  doc: Pick<CadDocument, "extensions"> = { extensions: {} },
): FeatureOutcome | void {
  const inputs = checkedFeatureInputs(feature, doc, sources);
  const run = () =>
    inputs
      ? evaluateFeature(next, feature, earlier, sources, inputs)
      : evaluateFeature(next, feature, earlier, sources);
  return cancellable(shouldStop, () =>
    withNamingVersion(namingVersion, () =>
      namingVersion === 1 ? run() : evaluateResolved(next, feature, run),
    ),
  );
}

export function trialBuild<T>(
  state: EvalState,
  feature: CadDocument["features"][number],
  earlier: CadDocument["features"],
  namingVersion: NamingVersion,
  shouldStop: () => boolean,
  inspect: (built: EvalState) => T,
): T {
  const next = { ...state };
  try {
    evaluateTracked(
      next,
      feature,
      earlier,
      new Map(),
      namingVersion,
      shouldStop,
    );
    return inspect(next);
  } finally {
    releaseSnapshots([{ state: next }], [{ state }]);
  }
}

function failedStatus(
  err: any,
  state: EvalState,
  feature: CadDocument["features"][number],
): FeatureStatus {
  const refs =
    err instanceof BlockedFeature
      ? err.refs
      : unresolvedRefs(state.bodies, feature);
  return {
    featureId: feature.id,
    status: "error",
    error: err?.message ?? String(err),
    ...(err?.bodyId && { bodyId: err.bodyId }),
    ...(refs.length > 0 && { refs }),
  };
}

function evaluateStep(
  next: EvalState,
  state: EvalState,
  feature: CadDocument["features"][number],
  earlier: CadDocument["features"],
  sources: Sources,
  namingVersion: NamingVersion,
  snapshots: Snapshot[],
  doc: CadDocument,
  shouldStop?: () => boolean,
): { status: FeatureStatus; deps?: Deps } | undefined {
  try {
    const { outcome, deps } = recorded(state, next, earlier, sources, (e, s) =>
      evaluateTracked(next, feature, e, s, namingVersion, shouldStop, doc),
    );
    return {
      status: okStatus(feature, outcome, state, next),
      ...(deps && { deps }),
    };
  } catch (err: any) {
    releaseSnapshots([{ state: next }], snapshots);
    if (shouldStop?.()) return;
    Object.assign(next, cloneState(state));
    if (err instanceof BlockedFeature)
      next.blocked = new Set([...state.blocked, ...err.bodies]);
    return { status: failedStatus(err, state, feature) };
  }
}

export interface EvaluateHooks {
  onFeatureStart?(index: number, featureId: string, featureKey: string): void;
  onProgress?(done: number, total: number, label: string): void;
  shouldStop?(): boolean;
}

function unreached(
  features: CadDocument["features"],
  from: number,
  upTo: number,
): FeatureStatus[] {
  return features.slice(from).map((feature, offset) => ({
    featureId: feature.id,
    status: from + offset < upTo ? "cancelled" : "rolledBack",
  }));
}

class DocumentEngine {
  bytes = 0;
  private wasm = 0;
  private js = 0;
  private snapshots: Snapshot[] = [];
  private stale = new Map<number, Snapshot>();
  private namingVersion?: NamingVersion;
  private held: Sources = new Map();
  private quarantine: CrashFeature[] = [];

  setQuarantine(features: CrashFeature[]) {
    if (JSON.stringify(this.quarantine) === JSON.stringify(features)) return;
    this.invalidate();
    this.quarantine = features;
  }

  constructor(readonly docId: string) {}

  get sources(): Sources {
    return this.held;
  }

  private measured<T>(work: () => T): T {
    const heap = heapBytes();
    try {
      return work();
    } finally {
      this.wasm += heapBytes() - heap;
      this.bytes = this.wasm + this.js;
      engineCache.adopt(this);
    }
  }

  evaluate(
    doc: CadDocument,
    position?: number,
    sources?: Sources,
    hooks?: EvaluateHooks,
  ): MeshedEvaluation {
    return this.measured(() => {
      const t0 = performance.now();
      const { state, statuses } = this.regenerate(
        doc,
        position,
        sources,
        hooks,
      );

      const bodies: MeshedBody[] = [];
      const memo: Decoded = new Map();
      let js = 0;
      for (const bytes of this.held.values()) js += bytes.byteLength;
      for (const body of state.bodies.values()) {
        const label = bodyLabel(state, doc, body.bodyId);
        const { head, binary, bytes } = this.tessellated(body, label, memo);
        bodies.push(lazyMesh({ ...head, ...label }, binary));
        js += bytes;
      }

      const sketches: SketchPayload[] = [...state.sketches.values()].map(
        (sk) => ({ ...sk }),
      );
      this.js = js + payloadBytes(sketches);

      const planes: ConstructionPlanePayload[] = [];
      for (const [featureId, p] of state.planes)
        planes.push({ featureId, frame: p.frame, size: p.size });

      return {
        bodies,
        featureStatuses: statuses,
        sketches,
        planes,
        kernelMs: Math.round(performance.now() - t0),
      };
    });
  }

  private regenerate(
    doc: CadDocument,
    position: number | undefined,
    sources: Sources | undefined,
    hooks?: EvaluateHooks,
  ) {
    doc = { ...doc, features: resolveDocumentParameters(doc).features };
    if (sources) this.held = sources;
    const upTo = Math.min(
      position ?? doc.timelinePosition,
      doc.features.length,
    );

    const keys: string[] = [];
    const keyAt = (i: number) =>
      (keys[i] ??= featureKey(doc.features[i]!, doc, this.held));
    let valid = 0;
    while (
      this.namingVersion === doc.namingVersion &&
      valid < this.snapshots.length &&
      valid < doc.features.length &&
      this.snapshots[valid]!.featureKeys.includes(keyAt(valid))
    )
      valid++;
    const discarded = retired(
      this.stale,
      this.snapshots.splice(valid),
      valid,
      doc.features.length,
      this.namingVersion === doc.namingVersion,
    );
    this.namingVersion = doc.namingVersion;
    try {
      return this.replay(doc, upTo, valid, keyAt, discarded, hooks);
    } finally {
      releaseSnapshots(discarded, [...this.snapshots, ...this.stale.values()]);
    }
  }

  private replay(
    doc: CadDocument,
    upTo: number,
    valid: number,
    keyAt: (i: number) => string,
    discarded: Snapshot[],
    hooks?: EvaluateHooks,
  ) {
    const start = Math.min(valid, upTo);

    let state: EvalState =
      start === 0 ? emptyState() : this.snapshots[start - 1]!.state;
    let statuses: FeatureStatus[] =
      start === 0 ? [] : [...this.snapshots[start - 1]!.statuses];
    const blocked = blockedFeatureIds(doc, statuses, this.quarantine, keyAt);

    let i = start;
    for (; i < upTo && !hooks?.shouldStop?.(); i++) {
      const feature = doc.features[i]!;
      let next = { ...state };
      let status: FeatureStatus;
      let deps: Deps | undefined;
      const crash = crashStatus(feature, keyAt(i), this.quarantine, blocked);
      const old = this.stale.get(i);
      const kept =
        feature.suppressed || crash
          ? undefined
          : reusable(old, keyAt(i), state, this.held);
      if (!kept) hooks?.onFeatureStart?.(i, feature.id, keyAt(i));
      if (kept) {
        next = replayed(state, old!.state, kept.writes);
        status = okStatus(feature, kept.outcome, state, next);
        deps = kept;
      } else if (feature.suppressed) {
        Object.assign(next, cloneState(state));
        status = { featureId: feature.id, status: "suppressed" };
      } else if (crash) {
        Object.assign(next, cloneState(state));
        status = crash;
        next.blocked = blockedBodies(state, feature);
      } else {
        const evaluated = evaluateStep(
          next,
          state,
          feature,
          doc.features.slice(0, i),
          this.held,
          doc.namingVersion,
          this.snapshots,
          doc,
          hooks?.shouldStop,
        );
        if (!evaluated) break;
        ({ status, deps } = evaluated);
      }
      statuses = statuses.concat(status);
      this.snapshots.push({
        featureKeys: featureKeys(feature, keyAt(i), status, doc, this.held),
        state: next,
        statuses,
        ...(deps && { deps }),
      });
      if (old) {
        discarded.push(old);
        this.stale.delete(i);
      }
      state = next;
      hooks?.onProgress?.(i + 1 - start, upTo - start, feature.name);
    }

    statuses = [...statuses, ...unreached(doc.features, i, upTo)];
    return { state, statuses, features: doc.features };
  }

  private tessellated(body: StateBody, label: { name: string }, memo: Decoded) {
    return (
      cached(body) ??
      store(body, this.moved(body, memo) ?? tessellateBody(body, label))
    );
  }

  private moved({ bodyId, copyOf }: StateBody, memo: Decoded) {
    const source = copyOf && cached(copyOf.source);
    return source && movePayload(sourceMesh(source, memo), bodyId, copyOf);
  }

  defaultTargets(
    doc: CadDocument,
    index: number,
    hidden: readonly string[],
    sources?: Sources,
  ): Pick<ExtrudeFeature, "targets" | "autoTargets"> | undefined {
    return this.measured(() => {
      const { statuses, features } = this.regenerate(doc, index + 1, sources);
      const before =
        index === 0 ? emptyState() : this.snapshots[index - 1]!.state;
      const excluded = new Set(hidden);
      let targets = statuses[index]?.targets;
      if (targets?.some((id) => excluded.has(id))) {
        const trial: EvalState = { ...before, hidden: excluded };
        try {
          targets = evaluateTracked(
            trial,
            features[index]!,
            features.slice(0, index),
            this.held,
            doc.namingVersion,
            undefined,
            doc,
          )?.targets;
        } finally {
          releaseSnapshots([{ state: trial }], this.snapshots);
        }
      }
      if (!targets || doc.namingVersion === 1) return targets && { targets };
      const ids = [...before.bodies.keys()];
      const earlier = features.slice(0, index);
      return { autoTargets: autoTargetsAt(ids, hidden, earlier) };
    });
  }

  stateAt(doc: CadDocument, position?: number, sources?: Sources): EvalState {
    return this.measured(() => this.regenerate(doc, position, sources).state);
  }

  invalidate(): void {
    try {
      releaseSnapshots([...this.snapshots, ...this.stale.values()], []);
    } finally {
      this.snapshots = [];
      this.stale.clear();
      this.held = new Map();
      this.bytes = this.wasm = this.js = 0;
    }
  }
}

export const engineCache = lruEngines((docId) => new DocumentEngine(docId));
export const engineFor = (docId: string) => engineCache.get(docId);
export const dropEngine = (docId: string) => engineCache.drop(docId);

export type { DocumentEngine };
export { tessCache };
