import type { Request, RequestHandler, Response } from "express";
import type { CadDocument, User } from "@rockett/shared";
import type { KernelClient } from "../kernel/client.js";
import { JobRegistry, jobContext, type Job } from "../kernel/jobs.js";
import { StoreError, type ProjectStore } from "../store/projectStore.js";
import { isProjectRoute, projectRole } from "./projectAccess.js";

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MISSING = { error: "job not found", code: "not_found" } as const;

function jobOutcome(job: Job, status: number) {
  if (job.hardCancelled) return "cancelled";
  if (status >= 400) return "failed";
  return job.cancelled ? "cancelled" : "done";
}

function committed() {
  const job = jobContext.getStore();
  if (job) job.generation = "committed";
}

function bindProject(projectId: string | null) {
  const job = jobContext.getStore();
  if (job) job.projectId = projectId;
}

export function createJobRoutes(
  store: ProjectStore,
  kernel: KernelClient,
  fail: (req: Request, res: Response, error: unknown) => void,
) {
  const jobs = new JobRegistry();
  const start: RequestHandler = (req, res, next) => {
    const id = req.get("Rockett-Job");
    if (id === undefined) return next();
    if (!JOB_ID.test(id))
      return res
        .status(400)
        .json({ error: "invalid Rockett-Job id", code: "validation" });
    const user: User | undefined = res.locals.user;
    if (!user) return fail(req, res, new Error("auth middleware missing"));
    let job;
    try {
      job = jobs.register(
        id,
        user.id,
        isProjectRoute(req) && typeof req.params.id === "string"
          ? req.params.id
          : null,
      );
    } catch (error) {
      if (error instanceof RangeError)
        return res
          .status(503)
          .json({ error: "too many active jobs", code: "kernel" });
      return res
        .status(409)
        .json({ error: "job id already registered", code: "conflict" });
    }
    res.on("finish", () => {
      jobs.release(job);
      jobs.finish(job, jobOutcome(job, res.statusCode));
    });
    res.on("close", () => {
      if (!res.writableFinished) {
        jobs.cancel(job);
        jobs.finish(job, "failed");
      }
    });
    jobContext.run(job, next);
  };

  async function available(req: Request, res: Response) {
    const job = jobs.get(req.params.jobId as string);
    const user: User | undefined = res.locals.user;
    if (!job || !user || job.userId !== user.id) return undefined;
    if (job.projectId === null) return job;
    try {
      const { owner, members } = await store.projectAccess(job.projectId);
      return projectRole(user, owner, members) ? job : undefined;
    } catch (error) {
      if (error instanceof StoreError && error.code === "not_found")
        return undefined;
      throw error;
    }
  }

  const events: RequestHandler = (req, res) => {
    void available(req, res)
      .then((job) => {
        if (!job) return res.status(404).json(MISSING);
        if (!jobs.subscribe(job, res))
          return res
            .status(503)
            .json({ error: "too many job subscribers", code: "kernel" });
      })
      .catch((error: unknown) => fail(req, res, error));
  };

  const cancel: RequestHandler = (req, res) => {
    void available(req, res)
      .then((job) => {
        if (!job) return res.status(404).json(MISSING);
        jobs.cancel(job);
        res.json({ ok: true });
      })
      .catch((error: unknown) => fail(req, res, error));
  };

  const evaluate = (
    doc: CadDocument,
    position?: number,
    sources?: Parameters<KernelClient["evaluate"]>[2],
  ) => {
    const job = jobContext.getStore();
    return kernel
      .evaluate(
        doc,
        position,
        sources,
        job && {
          onProgress: (done, total, label) =>
            jobs.progress(job, done, total, label),
          shouldStop: () => job.cancelRequested,
        },
      )
      .then((result) => {
        if (
          job &&
          result.featureStatuses.some(
            (feature) => feature.status === "cancelled",
          )
        )
          job.cancelled = true;
        return result;
      });
  };

  const settled = () => {
    const job = jobContext.getStore();
    if (job) jobs.release(job);
  };

  return { start, events, cancel, evaluate, settled, committed, bindProject };
}
