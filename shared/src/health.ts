export interface Health {
  version: string;
  schemaVersion: number;
  commit: string | null;
  describe: string | null;
  kernelVersion: { occt: string; commit: string } | null;
  kernel: "starting" | "ready" | "restarting" | "failed";
}

export type HealthResponse = Health | { ok: true };
