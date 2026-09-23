import { version } from "../../package.json";

export function build(): { version: string; commit: string | null } {
  return { version, commit: process.env.ROCKETT_COMMIT || null };
}
