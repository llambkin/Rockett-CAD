import { DAY, HOUR, MB, MINUTE, SESSION_DAY_RANGE } from "@rockett/shared";

export const TIMING_MS = {
  temporaryProjectLifetime: DAY,
  temporaryProjectTouch: MINUTE,
  temporaryProjectSweep: HOUR,
  sessionDay: DAY,
  sessionLongest: SESSION_DAY_RANGE.maximum * DAY,
  sessionSave: MINUTE,
  authFailureWindow: 15 * MINUTE,
  signInStep: 10 * MINUTE,
  sizeLimitSearch: 1000,
  jobRetention: 10 * MINUTE,
  jobRuntime: 10 * MINUTE,
  jobHardCancel: 2000,
  kernelRestartWindow: 5 * MINUTE,
  kernelRestartBackoff: [1000, 2000, 4000],
  jobSubscriberIdle: 2 * MINUTE,
  accessKeyCache: HOUR,
  accessJwtSkew: MINUTE,
  accessKeyFetch: 10_000,
  previewIdle: HOUR,
  orphanBlobAge: DAY,
  shutdownGrace: 8000,
} as const;

export const TRIAL_BUDGET = {
  sizeLimitBuilds: 8,
} as const;

export const PREVIEW_LIMITS = {
  bytes: 256 * MB,
} as const;

export const JOB_LIMITS = {
  active: 32,
  finished: 100,
  events: 64,
  subscribers: 8,
} as const;
