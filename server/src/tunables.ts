import { totalmem } from "node:os";
import {
  DAY,
  HOUR,
  MB,
  MINUTE,
  PROJECT_FILE_LIMIT_MB,
  SESSION_DAY_RANGE,
} from "@rockett/shared";

const WASM_HEAP_MAX = 4096 * MB;
const KERNEL_HEAP_START = 100 * MB;
const CUT_HEAP_PER_MESH_TRIANGLE = 9860;
const hostMemory = Math.min(
  process.constrainedMemory() || Infinity,
  totalmem(),
);

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
  jobStall: 10 * MINUTE,
  jobCeiling: 6 * HOUR,
  jobHardCancel: 2000,
  kernelRestartWindow: 5 * MINUTE,
  kernelRestartBackoff: [1000, 2000, 4000],
  jobSubscriberIdle: 2 * MINUTE,
  accessKeyCache: HOUR,
  accessJwtSkew: MINUTE,
  accessKeyFetch: 10_000,
  previewIdle: HOUR,
  orphanBlobAge: DAY,
  deletedProjectBackupAge: 30 * DAY,
  shutdownGrace: 8000,
} as const;

export const TRIAL_BUDGET = {
  sizeLimitBuilds: 8,
} as const;

export const PREVIEW_LIMITS = {
  bytes: 256 * MB,
} as const;

export const HISTORY_LIMITS = {
  snapshotBytes: 2 * PROJECT_FILE_LIMIT_MB * MB,
  checkpoints: 1000,
  bytes: 256 * MB,
} as const;

export const ENGINE_CACHE = {
  bytes: Math.min(hostMemory / 4, WASM_HEAP_MAX / 2),
} as const;

export const MESH_LIMITS = {
  cutTriangles: Math.floor(
    (WASM_HEAP_MAX - KERNEL_HEAP_START) / CUT_HEAP_PER_MESH_TRIANGLE,
  ),
} as const;

export const JOB_LIMITS = {
  active: 32,
  finished: 100,
  events: 64,
  subscribers: 8,
} as const;

export const BACKUP_LIMITS = {
  live: 20,
} as const;

export const PLUGIN_LIMITS = {
  plugins: 64,
  entries: 4096,
  bytes: 256 * MB,
} as const;

function megabytesSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = env[name]?.trim();
  if (!value) return fallback * MB;
  const megabytes = Number(value);
  if (!Number.isFinite(megabytes) || megabytes <= 0)
    throw new Error(`${name} must be a positive number of megabytes`);
  return Math.floor(megabytes * MB);
}

export const importLimits = (env: NodeJS.ProcessEnv) => ({
  uploadBytes: megabytesSetting(env, "ROCKETT_UPLOAD_MAX_MB", 1024),
  importBytes: megabytesSetting(env, "ROCKETT_IMPORT_BUDGET_MB", 256),
});

export type ImportLimits = ReturnType<typeof importLimits>;

export const IMPORT_LIMITS = importLimits(process.env);
