import { bodyName, resolveDocumentParameters } from "@rockett/shared";
import type {
  BodyPayload,
  CadDocument,
  ConstructionPlanePayload,
  EvaluateResult,
  FeatureStatus,
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
import "./kinds.js";
import type { Sources } from "./importers.js";
import { movePayload, tessellateBody } from "./tessellate.js";
import { withNamingVersion, type NamedBody } from "./naming.js";
import { modifiedFaces } from "./modified.js";
import { cancellable, release, shapeHash, type Shape } from "./kernel.js";
import { heapBytes, lruEngines } from "./engineCache.js";
import {
  BlockedFeature,
  CRASH_BLOCKED_MESSAGE,
  blockedBodies,
  crashStatus,
  evaluateResolved,
  unresolvedRefs,
  type CrashFeature,
} from "./resolve.js";

function blockedFeatureIds(
  doc: CadDocument,
  statuses: FeatureStatus[],
  quarantine: CrashFeature[],
) {
  const ids = new Set(
    statuses
      .filter((status) => status.error === CRASH_BLOCKED_MESSAGE)
      .map((status) => status.featureId),
  );
  for (const entry of quarantine)
    if (
      doc.features.some(
        (feature) =>
          !feature.suppressed &&
          feature.id === entry.featureId &&
          featureKey(feature) === entry.featureKey,
      )
    )
      ids.add(entry.featureId);
  return ids;
}

interface Snapshot {
  featureKeys: string[];
  state: EvalState;
  statuses: FeatureStatus[];
}

const snapshotBodies = (snapshots: Pick<Snapshot, "state">[]) =>
  snapshots.flatMap((snapshot) => [...snapshot.state.bodies.values()]);

function releaseSnapshots(
  discarded: Pick<Snapshot, "state">[],
  retained: Pick<Snapshot, "state">[],
): void {
  const kept = snapshotBodies(retained);
  const keptShapes = new Set(kept.map((b) => b.shape));
  const keptNames = new Set(kept.map((b) => b.names));
  const dropped = snapshotBodies(discarded);
  const freed = dropped.filter((b) => !keptShapes.has(b.shape));
  for (const body of freed) {
    const key = cacheKey(body);
    if (tessCache.entries.get(key)?.shape === body.shape) evict(key);
  }
  const names = [...new Set(dropped.map((b) => b.names))].filter(
    (bodyNames) => !keptNames.has(bodyNames),
  );
  release([
    ...names
      .toReversed()
      .map((bodyNames) => ({ delete: () => bodyNames.release() })),
    ...new Set(freed.map((b) => b.shape)),
  ]);
}

function evaluateTracked(
  next: EvalState,
  feature: CadDocument["features"][number],
  earlier: CadDocument["features"],
  sources: Sources,
  namingVersion: NamingVersion,
  shouldStop?: () => boolean,
): FeatureOutcome | void {
  const run = () => evaluateFeature(next, feature, earlier, sources);
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
  shouldStop?: () => boolean,
): FeatureStatus | undefined {
  try {
    const outcome = evaluateTracked(
      next,
      feature,
      earlier,
      sources,
      namingVersion,
      shouldStop,
    );
    const modified = modifiedFaces(state.bodies, next.bodies);
    return {
      featureId: feature.id,
      status: outcome?.warning ? "warning" : "ok",
      ...outcome,
      ...(modified && { modified }),
    };
  } catch (err: any) {
    releaseSnapshots([{ state: next }], snapshots);
    if (shouldStop?.()) return;
    next.bodies = new Map(state.bodies);
    next.sketches = new Map(state.sketches);
    next.planes = new Map(state.planes);
    if (err instanceof BlockedFeature)
      next.blocked = new Set([...state.blocked, ...err.bodies]);
    return failedStatus(err, state, feature);
  }
}

export function featureKey(feature: object): string {
  return JSON.stringify(feature);
}

function featureKeys(
  feature: CadDocument["features"][number],
  key: string,
  { targets }: FeatureStatus,
): string[] {
  return targets && !("targets" in feature)
    ? [key, featureKey({ ...feature, targets })]
    : [key];
}

interface Tessellation {
  shape: Shape;
  payload: BodyPayload;
  bytes: number;
}

export const tessCache = {
  limit: 256 * 1024 * 1024,
  bytes: 0,
  entries: new Map<string, Tessellation>(),
};

function payloadBytes(value: unknown): number {
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value === "string") return value.length * 2;
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value) && typeof value[0] === "number")
    return value.length * 8;
  let bytes = 0;
  for (const v of Object.values(value)) bytes += payloadBytes(v);
  return bytes;
}

function cacheKey(body: NamedBody): string {
  return `${body.bodyId}:${shapeHash(body.shape)}`;
}

function evict(key: string): void {
  const entry = tessCache.entries.get(key);
  if (!entry) return;
  tessCache.entries.delete(key);
  tessCache.bytes -= entry.bytes;
}

function store(body: NamedBody, payload: BodyPayload): Tessellation {
  const key = cacheKey(body);
  evict(key);
  const entry = { shape: body.shape, payload, bytes: payloadBytes(payload) };
  tessCache.entries.set(key, entry);
  tessCache.bytes += entry.bytes;
  for (const old of tessCache.entries.keys()) {
    if (tessCache.bytes <= tessCache.limit) break;
    evict(old);
  }
  return entry;
}

function cached(body: NamedBody): Tessellation | undefined {
  const key = cacheKey(body);
  const entry = tessCache.entries.get(key);
  if (!entry) return undefined;
  if (entry.shape.isDeleted()) {
    evict(key);
    return undefined;
  }
  if (body.shape.isDeleted() || !entry.shape.IsSame(body.shape))
    return undefined;
  tessCache.entries.delete(key);
  tessCache.entries.set(key, entry);
  return entry;
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
  ): EvaluateResult {
    return this.measured(() => {
      const t0 = performance.now();
      const { state, statuses } = this.regenerate(
        doc,
        position,
        sources,
        hooks,
      );

      const bodies: BodyPayload[] = [];
      let js = 0;
      for (const bytes of this.held.values()) js += bytes.byteLength;
      for (const body of state.bodies.values()) {
        const name = bodyName(doc, body.bodyId);
        const { payload, bytes } = this.tessellated(body, name);
        bodies.push({ ...payload, name });
        js += bytes;
      }

      const sketches: SketchPayload[] = [...state.sketches.values()].map(
        (sk) => ({ ...sk }),
      );
      this.js = js + payloadBytes(sketches);

      const planes: ConstructionPlanePayload[] = [];
      for (const [featureId, p] of state.planes) {
        planes.push({ featureId, frame: p.frame, size: p.size });
      }

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
    const keyAt = (i: number) => (keys[i] ??= featureKey(doc.features[i]!));
    let valid = 0;
    while (
      this.namingVersion === doc.namingVersion &&
      valid < this.snapshots.length &&
      valid < doc.features.length &&
      this.snapshots[valid]!.featureKeys.includes(keyAt(valid))
    )
      valid++;
    releaseSnapshots(this.snapshots.splice(valid), this.snapshots);
    this.namingVersion = doc.namingVersion;
    const start = Math.min(valid, upTo);

    let state: EvalState =
      start === 0 ? emptyState() : this.snapshots[start - 1]!.state;
    let statuses: FeatureStatus[] =
      start === 0 ? [] : [...this.snapshots[start - 1]!.statuses];
    const blockedFeatures = blockedFeatureIds(doc, statuses, this.quarantine);

    let i = start;
    for (; i < upTo && !hooks?.shouldStop?.(); i++) {
      const feature = doc.features[i]!;
      hooks?.onFeatureStart?.(i, feature.id, keyAt(i));
      const next = { ...state };
      let status: FeatureStatus;
      const crash = crashStatus(
        feature,
        keyAt(i),
        this.quarantine,
        blockedFeatures,
      );
      if (feature.suppressed) {
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
          hooks?.shouldStop,
        );
        if (!evaluated) break;
        status = evaluated;
      }
      statuses = statuses.concat(status);
      this.snapshots.push({
        featureKeys: featureKeys(feature, keyAt(i), status),
        state: next,
        statuses,
      });
      state = next;
      hooks?.onProgress?.(i + 1 - start, upTo - start, feature.name);
    }

    statuses = [...statuses, ...unreached(doc.features, i, upTo)];
    return { state, statuses, features: doc.features };
  }

  private tessellated(body: StateBody, name: string): Tessellation {
    return (
      cached(body) ??
      store(body, this.moved(body) ?? tessellateBody(body, { name }))
    );
  }

  private moved({ bodyId, copyOf }: StateBody): BodyPayload | undefined {
    const source = copyOf && cached(copyOf.source)?.payload;
    return source && movePayload(source, bodyId, copyOf);
  }

  visibleTargets(
    doc: CadDocument,
    index: number,
    hidden: readonly string[],
    sources?: Sources,
  ): string[] | undefined {
    return this.measured(() => {
      const { statuses, features } = this.regenerate(doc, index + 1, sources);
      const found = statuses[index]?.targets;
      const excluded = new Set(hidden);
      if (!found?.some((id) => excluded.has(id))) return found;
      const before =
        index === 0 ? emptyState() : this.snapshots[index - 1]!.state;
      const trial: EvalState = { ...before, hidden: excluded };
      try {
        return evaluateTracked(
          trial,
          features[index]!,
          features.slice(0, index),
          this.held,
          doc.namingVersion,
        )?.targets;
      } finally {
        releaseSnapshots([{ state: trial }], this.snapshots);
      }
    });
  }

  stateAt(doc: CadDocument, position?: number, sources?: Sources): EvalState {
    return this.measured(() => this.regenerate(doc, position, sources).state);
  }

  invalidate(): void {
    try {
      releaseSnapshots(this.snapshots, []);
    } finally {
      this.snapshots = [];
      this.held = new Map();
      this.bytes = this.wasm = this.js = 0;
    }
  }
}

export const engineCache = lruEngines((docId) => new DocumentEngine(docId));
export const engineFor = (docId: string) => engineCache.get(docId);
export const dropEngine = (docId: string) => engineCache.drop(docId);

export type { DocumentEngine };
