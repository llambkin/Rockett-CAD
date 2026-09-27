import { AsyncLocalStorage } from "node:async_hooks";
import type { Response } from "express";
import { JOB_LIMITS, TIMING_MS } from "../tunables.js";

export type JobEvent =
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "done" | "failed" | "cancelled" };

type Subscriber = { response: Response; idle?: NodeJS.Timeout };

export interface Job {
  id: string;
  userId: string;
  projectId: string | null;
  cancelRequested: boolean;
  cancelled: boolean;
  state: "running" | "done" | "failed" | "cancelled";
  finishedAt?: number;
  events: JobEvent[];
  subscribers: Set<Subscriber>;
  runtime: NodeJS.Timeout;
}

export const jobContext = new AsyncLocalStorage<Job>();

export class JobRegistry {
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Map<string, Job>();

  get(id: string): Job | undefined {
    this.prune();
    return this.jobs.get(id);
  }

  size(): number {
    this.prune();
    return this.jobs.size;
  }

  register(id: string, userId: string, projectId: string | null): Job {
    this.prune();
    if (this.jobs.has(id) || this.active.has(id))
      throw new Error("duplicate job id");
    if (this.active.size >= JOB_LIMITS.active)
      throw new RangeError("too many active jobs");
    const job: Job = {
      id,
      userId,
      projectId,
      cancelRequested: false,
      cancelled: false,
      state: "running",
      events: [],
      subscribers: new Set(),
      runtime: setTimeout(() => {
        job.cancelRequested = true;
        this.finish(job, "failed");
      }, TIMING_MS.jobRuntime),
    };
    job.runtime.unref();
    this.jobs.set(id, job);
    this.active.set(id, job);
    return job;
  }

  progress(job: Job, done: number, total: number, label: string): void {
    if (job.state !== "running") return;
    this.emit(job, { type: "progress", done, total, label });
  }

  finish(job: Job, type: "done" | "failed" | "cancelled"): void {
    if (job.state !== "running") return;
    job.state = type;
    job.finishedAt = Date.now();
    clearTimeout(job.runtime);
    if (this.jobs.get(job.id) === job) {
      this.jobs.delete(job.id);
      this.jobs.set(job.id, job);
    }
    this.emit(job, { type });
    this.prune();
  }

  cancel(job: Job): void {
    if (job.state === "running") job.cancelRequested = true;
  }

  release(job: Job): void {
    if (this.active.get(job.id) === job) this.active.delete(job.id);
    this.prune();
  }

  subscribe(job: Job, response: Response): boolean {
    if (job.subscribers.size >= JOB_LIMITS.subscribers) return false;
    response.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    const subscriber: Subscriber = { response };
    const close = () => {
      clearTimeout(subscriber.idle);
      job.subscribers.delete(subscriber);
      if (!response.writableEnded) response.end();
    };
    subscriber.idle = setTimeout(close, TIMING_MS.jobSubscriberIdle);
    subscriber.idle.unref();
    job.subscribers.add(subscriber);
    response.on("close", close);
    for (const event of job.events) {
      if (!this.write(subscriber, event)) break;
    }
    if (job.state !== "running") close();
    return true;
  }

  private emit(job: Job, event: JobEvent): void {
    job.events.push(event);
    if (job.events.length > JOB_LIMITS.events) job.events.shift();
    for (const subscriber of job.subscribers) this.write(subscriber, event);
    if (event.type !== "progress")
      for (const subscriber of job.subscribers) subscriber.response.end();
  }

  private write(subscriber: Subscriber, event: JobEvent): boolean {
    if (subscriber.response.writableEnded) return false;
    clearTimeout(subscriber.idle);
    subscriber.idle = setTimeout(
      () => subscriber.response.end(),
      TIMING_MS.jobSubscriberIdle,
    );
    subscriber.idle.unref();
    const sent = subscriber.response.write(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    if (!sent) subscriber.response.end();
    return sent;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs)
      if (
        job.finishedAt !== undefined &&
        now - job.finishedAt >= TIMING_MS.jobRetention
      )
        this.jobs.delete(id);
    const finished = [...this.jobs.values()].filter(
      (job) => job.finishedAt !== undefined,
    );
    for (const job of finished.slice(
      0,
      Math.max(0, finished.length - JOB_LIMITS.finished),
    ))
      this.jobs.delete(job.id);
  }
}
