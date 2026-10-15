import type { Health } from "./api";

export function versionLabel(h: Health): { text: string; title: string } {
  return {
    text: h.describe ?? `v${h.version} ${h.commit?.slice(0, 7) ?? "dev"}`,
    title: `Commit ${h.commit ?? "not recorded"}\nVersion ${h.version}\nSchema ${h.schemaVersion}`,
  };
}
