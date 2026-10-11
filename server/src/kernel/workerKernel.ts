import {
  Worker,
  type Transferable,
  type WorkerOptions,
} from "node:worker_threads";
import type { CadDocument, Health, NamingDecision } from "@rockett/shared";
import type { ProjectStore } from "../store/projectStore.js";
import { StoreError } from "../store/projectStore.js";
import { TIMING_MS } from "../tunables.js";
import type { Sources } from "../geometry/importers.js";
import type { ImportUpload } from "../api/importers.js";
import type { EvaluateHooks } from "../geometry/engine.js";
import type { CrashFeature } from "../geometry/resolve.js";
import type { FeatureBundle } from "../modules/features.js";
import { jobContext, type Job } from "./jobs.js";
import type {
  ExportJob,
  KernelClient,
  SignRequest,
  StateAnswers,
  StateQuery,
} from "./client.js";
import {
  fromWire,
  meshesFromWire,
  owned,
  toWire,
  type Calls,
  type FromWorker,
  type Method,
  type Payload,
  type Report,
  type Settled,
  type ToWorker,
} from "./protocol.js";

interface Pending {
  resolve: (value: Calls[Method]["result"]) => void;
  reject: (error: Error) => void;
  payload: (held: string[]) => Promise<Payload>;
  report?: ((message: Report) => void) | undefined;
  job?: Job | undefined;
  projectId?: string | undefined;
  activeFeature?: CrashFeature | undefined;
  cancelTimer?: NodeJS.Timeout | undefined;
  onCancel?: (() => void) | undefined;
}

function stopFlag(hooks: EvaluateHooks) {
  const stop = new Int32Array(new SharedArrayBuffer(4));
  const check = () => {
    if (hooks.shouldStop?.()) Atomics.store(stop, 0, 1);
  };
  check();
  return { stop, check };
}

const noPayload = () =>
  Promise.reject(new Error("this kernel call carries no payload"));

export class WorkerKernel implements KernelClient {
  private worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private lastId = 0;
  private kernelVersion: Health["kernelVersion"] = null;
  private failure: Error | undefined;
  private restarting = false;
  private retiring: Worker | undefined;
  private restartTask: Promise<void> | undefined;
  private readonly quarantined = new Map<string, CrashFeature[]>();
  private restartTimes: number[] = [];
  private closed = false;
  private readonly bundles = new Set<FeatureBundle>();

  constructor(
    private readonly store: Pick<ProjectStore, "sources">,
    private readonly entry: URL,
    private readonly options?: WorkerOptions,
  ) {
    this.worker = this.spawn();
  }

  private spawn() {
    const worker = new Worker(this.entry, this.options);
    worker.on("message", (message: FromWorker) => {
      if (this.worker === worker && this.retiring !== worker)
        this.receive(message);
    });
    worker.on("error", (error) => {
      if (this.worker === worker && this.retiring !== worker)
        this.restart(error);
    });
    worker.on("exit", (code) => {
      if (this.worker === worker && this.retiring !== worker && !this.closed)
        this.restart(new Error(`The kernel worker exited with code ${code}`));
    });
    return worker;
  }

  private clear(pending: Pending) {
    clearTimeout(pending.cancelTimer);
    if (pending.onCancel)
      pending.job?.cancelController.signal.removeEventListener(
        "abort",
        pending.onCancel,
      );
  }

  private armCancel(id: number, pending: Pending) {
    clearTimeout(pending.cancelTimer);
    pending.cancelTimer = setTimeout(() => {
      if (this.pending.get(id) !== pending) return;
      if (pending.job) {
        pending.job.cancelled = true;
        pending.job.hardCancelled = true;
      }
      this.restart();
    }, TIMING_MS.jobHardCancel);
  }

  private restart(cause?: Error) {
    if (this.restarting || this.failure || this.closed) return;
    if (cause)
      for (const pending of this.pending.values()) {
        if (pending.projectId && pending.activeFeature) {
          const features = this.quarantined.get(pending.projectId) ?? [];
          this.quarantined.set(pending.projectId, [
            ...features.filter(
              (feature) =>
                feature.featureId !== pending.activeFeature!.featureId,
            ),
            pending.activeFeature,
          ]);
        }
      }
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter(
      (time) => now - time < TIMING_MS.kernelRestartWindow,
    );
    const old = this.worker;
    this.retiring = old;
    this.kernelVersion = null;
    if (this.restartTimes.length >= TIMING_MS.kernelRestartBackoff.length) {
      const error = new StoreError("kernel restart limit reached", "kernel");
      error.cause = cause;
      this.fail(error);
      this.restartTask = old.terminate().then(
        () => undefined,
        (terminationError: unknown) => {
          error.cause = terminationError;
        },
      );
      return;
    }
    const delay = TIMING_MS.kernelRestartBackoff[this.restartTimes.length]!;
    this.restartTimes.push(now);
    this.restarting = true;
    const error = new StoreError("kernel restarted", "kernel");
    if (cause) error.cause = cause;
    for (const pending of this.pending.values()) {
      this.clear(pending);
      pending.reject(error);
    }
    this.pending.clear();
    this.restartTask = Promise.all([
      new Promise<void>((resolve) => setTimeout(resolve, delay)),
      old.terminate(),
    ])
      .then(() => {
        if (!this.closed) this.worker = this.spawn();
      })
      .catch((failure: unknown) => {
        const restartError = new StoreError("kernel restart failed", "kernel");
        restartError.cause = failure;
        this.fail(restartError);
      })
      .finally(() => {
        this.retiring = undefined;
      });
  }

  private post(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  private receive(message: FromWorker) {
    switch (message.type) {
      case "ready":
        this.kernelVersion = message.version;
        this.restarting = false;
        if (this.bundles.size)
          this.call("features", [[...this.bundles]]).catch(() => undefined);
        return;
      case "ask":
        void this.answer(message.id, message.held).catch((error: unknown) => {
          if (this.pending.has(message.id))
            this.fail(
              error instanceof Error
                ? error
                : new Error("kernel payload delivery failed"),
            );
        });
        return;
      case "featureStart":
      case "progress":
        {
          const pending = this.pending.get(message.id);
          if (pending && message.type === "featureStart")
            pending.activeFeature = {
              featureId: message.args[1],
              featureKey: message.args[2],
            };
          if (pending && message.type === "progress")
            pending.activeFeature = undefined;
          pending?.report?.(message);
          if (message.type === "progress" && pending?.cancelTimer)
            this.armCancel(message.id, pending);
        }
        return;
      case "reply": {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (pending) this.clear(pending);
        const { settled } = message;
        if (settled.ok) pending?.resolve(settled.value);
        else pending?.reject(fromWire(settled.error));
        return;
      }
    }
  }

  private async answer(id: number, held: string[]) {
    const pending = this.pending.get(id);
    if (!pending) return;
    const worker = this.worker;
    let settled: Settled<Payload>;
    try {
      const value = await pending.payload(held);
      settled = { ok: true, value };
    } catch (error) {
      settled = { ok: false, error: toWire(error) };
    }
    if (
      this.pending.get(id) !== pending ||
      this.worker !== worker ||
      this.retiring === worker
    )
      return;
    try {
      worker.postMessage(
        { type: "payload", id, settled },
        settled.ok && settled.value instanceof ArrayBuffer
          ? [settled.value]
          : [],
      );
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new Error("kernel payload delivery failed"),
      );
    }
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      this.clear(pending);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  private call<M extends Method>(
    method: M,
    args: Calls[M]["args"],
    payload: Pending["payload"] = noPayload,
    report?: Pending["report"],
    job: Job | undefined = jobContext.getStore(),
    projectId?: string,
  ): Promise<Calls[M]["result"]> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      if (this.restarting)
        return reject(new StoreError("kernel restarted", "kernel"));
      const id = ++this.lastId;
      const pending: Pending = {
        resolve: resolve as Pending["resolve"],
        reject,
        payload,
        report,
        job,
        projectId,
      };
      this.pending.set(id, pending);
      if (job) {
        pending.onCancel = () => this.armCancel(id, pending);
        job.cancelController.signal.addEventListener(
          "abort",
          pending.onCancel,
          {
            once: true,
          },
        );
        if (job.cancelController.signal.aborted) pending.onCancel();
      }
      try {
        if (projectId)
          this.post({
            type: "quarantine",
            docId: projectId,
            features: this.quarantined.get(projectId) ?? [],
          });
        this.post({ type: "call", id, method, args } as ToWorker);
      } catch (error) {
        this.pending.delete(id);
        this.clear(pending);
        reject(error);
      }
    });
  }

  private sources(doc: CadDocument) {
    return async (held: string[]) => {
      const reused = new Uint8Array();
      const found = await this.store.sources(
        doc,
        new Map(held.map((hash) => [hash, reused])),
      );
      return new Map(
        [...found].map(([hash, bytes]) => [
          hash,
          bytes === reused ? null : bytes,
        ]),
      );
    };
  }

  evaluate(
    doc: CadDocument,
    position?: number,
    extra?: Sources,
    hooks: EvaluateHooks = {},
  ) {
    const { stop, check } = stopFlag(hooks);
    return this.call(
      "evaluate",
      [doc, position, extra, stop],
      this.sources(doc),
      (message) => {
        if (message.type === "featureStart")
          hooks.onFeatureStart?.(...message.args);
        else hooks.onProgress?.(...message.args);
        check();
      },
      jobContext.getStore(),
      doc.id,
    ).then((result) => {
      const remaining = (this.quarantined.get(doc.id) ?? []).filter(
        (crashed) =>
          !result.featureStatuses.some(
            (status) =>
              status.featureId === crashed.featureId &&
              (status.status === "ok" || status.status === "warning"),
          ),
      );
      if (remaining.length) this.quarantined.set(doc.id, remaining);
      else this.quarantined.delete(doc.id);
      return meshesFromWire(result);
    });
  }

  async stateQuery<K extends keyof StateAnswers>(
    doc: CadDocument,
    query: StateQuery<K>,
  ) {
    return (await this.call(
      "stateQuery",
      [doc, query as StateQuery],
      this.sources(doc),
      undefined,
      jobContext.getStore(),
      doc.id,
    )) as StateAnswers[K];
  }

  defaultTargets(doc: CadDocument, index: number, hidden: readonly string[]) {
    return this.call(
      "defaultTargets",
      [doc, index, hidden],
      this.sources(doc),
      undefined,
      jobContext.getStore(),
      doc.id,
    );
  }

  signResolved(doc: CadDocument, requests: SignRequest[]) {
    return this.call(
      "signResolved",
      [doc, requests],
      this.sources(doc),
      undefined,
      jobContext.getStore(),
      doc.id,
    );
  }

  async export(doc: CadDocument, job: ExportJob) {
    const { data, ...file } = await this.call(
      "export",
      [doc, job],
      this.sources(doc),
      undefined,
      jobContext.getStore(),
      doc.id,
    );
    return { data: Buffer.from(data), ...file };
  }

  formats() {
    return this.call("formats", []);
  }

  importStep(upload: ImportUpload | undefined) {
    return this.call(
      "importStep",
      [upload?.name],
      upload && (async () => owned(await upload.bytes())),
    );
  }

  planNamingUpgrade(doc: CadDocument, accept?: NamingDecision[]) {
    return this.call(
      "planNamingUpgrade",
      [doc, accept],
      this.sources(doc),
      undefined,
      jobContext.getStore(),
      doc.id,
    );
  }

  moduleJob(
    entry: string,
    id: string,
    input: unknown,
    hooks: EvaluateHooks = {},
  ) {
    const { stop, check } = stopFlag(hooks);
    return this.call(
      "moduleJob",
      [entry, id, input, stop],
      noPayload,
      (message) => {
        if (message.type === "progress") hooks.onProgress?.(...message.args);
        check();
      },
    );
  }

  async installFeatures(bundle: FeatureBundle) {
    const sync = () => this.call("features", [[...this.bundles]]);
    this.bundles.add(bundle);
    await sync().catch((error: unknown) => {
      this.bundles.delete(bundle);
      throw error;
    });
    return () => {
      if (this.bundles.delete(bundle)) sync().catch(() => undefined);
    };
  }

  drop(docId: string) {
    this.quarantined.delete(docId);
    if (!this.failure && !this.restarting) this.post({ type: "drop", docId });
  }

  version() {
    return this.kernelVersion;
  }

  status() {
    return this.failure
      ? ("failed" as const)
      : this.restarting
        ? ("restarting" as const)
        : this.kernelVersion
          ? ("ready" as const)
          : ("starting" as const);
  }

  async close() {
    this.closed = true;
    await this.restartTask;
    await this.worker.terminate();
    this.fail(new Error("The kernel worker exited"));
  }
}
