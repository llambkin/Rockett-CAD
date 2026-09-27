import { DAY, HOUR, MINUTE } from "@rockett/shared";

export const TIMING_MS = {
  temporaryProjectLifetime: DAY,
  temporaryProjectTouch: MINUTE,
  temporaryProjectSweep: HOUR,
  sessionIdle: 7 * DAY,
  sessionAbsolute: 30 * DAY,
  authFailureWindow: 15 * MINUTE,
  sizeLimitSearch: 1000,
  jobRetention: 10 * MINUTE,
  jobRuntime: 10 * MINUTE,
  jobHardCancel: 2000,
  jobSubscriberIdle: 2 * MINUTE,
} as const;

export const TRIAL_BUDGET = {
  sizeLimitBuilds: 8,
} as const;

export const JOB_LIMITS = {
  active: 32,
  finished: 100,
  events: 64,
  subscribers: 8,
} as const;
