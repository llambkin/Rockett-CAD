import type { HealthResponse } from "@rockett/shared";

export function versionLabel(h: HealthResponse) {
  if (!("version" in h)) return;
  return {
    text: h.describe ?? `v${h.version} ${h.commit?.slice(0, 7) ?? "dev"}`,
    title: `Commit ${h.commit ?? "not recorded"}\nVersion ${h.version}\nSchema ${h.schemaVersion}`,
  };
}
