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
import type { EvaluateHooks } from "../geometry/engine.js";
import { jobContext, type Job } from "./jobs.js";
import type {
  ExportJob,
  ImportUpload,
  KernelClient,
  StateAnswers,
  StateQuery,
} from "./client.js";
import {
  fromWire,
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
  cancelTimer?: NodeJS.Timeout | undefined;
  onCancel?: (() => void) | undefined;
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
      if (this.worker === worker && this.retiring !== worker) this.fail(error);
    });
    worker.on("exit", (code) => {
      if (this.worker === worker && this.retiring !== worker)
        this.fail(new Error(`The kernel worker exited with code ${code}`));
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

  private restart() {
    const old = this.worker;
    this.retiring = old;
    this.restarting = true;
    this.kernelVersion = null;
    const error = new StoreError("kernel restarted", "kernel");
    for (const pending of this.pending.values()) {
      this.clear(pending);
      pending.reject(error);
    }
    this.pending.clear();
    this.restartTask = old
      .terminate()
      .then(() => {
        this.worker = this.spawn();
      })
      .catch((cause: unknown) => {
        const failure = new StoreError("kernel restart failed", "kernel");
        failure.cause = cause;
        this.fail(failure);
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
    const stop = new Int32Array(new SharedArrayBuffer(4));
    const check = () => {
      if (hooks.shouldStop?.()) Atomics.store(stop, 0, 1);
    };
    check();
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
    );
  }

  async stateQuery<K extends keyof StateAnswers>(
    doc: CadDocument,
    query: StateQuery<K>,
  ) {
    return (await this.call(
      "stateQuery",
      [doc, query as StateQuery],
      this.sources(doc),
    )) as StateAnswers[K];
  }

  visibleTargets(doc: CadDocument, index: number, hidden: readonly string[]) {
    return this.call("visibleTargets", [doc, index, hidden], this.sources(doc));
  }

  async export(doc: CadDocument, job: ExportJob) {
    const { data, ...file } = await this.call(
      "export",
      [doc, job],
      this.sources(doc),
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
    return this.call("planNamingUpgrade", [doc, accept], this.sources(doc));
  }

  drop(docId: string) {
    if (!this.failure && !this.restarting) this.post({ type: "drop", docId });
  }

  version() {
    return this.kernelVersion;
  }

  status() {
    return this.restarting
      ? ("restarting" as const)
      : this.kernelVersion
        ? ("ready" as const)
        : ("starting" as const);
  }

  async close() {
    await this.restartTask;
    await this.worker.terminate();
  }
}
