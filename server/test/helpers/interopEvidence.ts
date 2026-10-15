import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect } from "vitest";

const dir = new URL("../fixtures/interop/", import.meta.url);

function comparable(name: string, bytes: Uint8Array): unknown {
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  if (name.endsWith(".step"))
    return text(bytes).replace(/FILE_NAME\([\s\S]*?\);/, "FILE_NAME();");
  if (name.endsWith(".3mf"))
    return Object.entries(unzipSync(bytes))
      .map(([entry, data]) => [entry, text(data)])
      .sort(([a], [b]) => a!.localeCompare(b!));
  return text(bytes);
}

export function expectEvidence(name: string, bytes: Uint8Array): void {
  const file = new URL(name, dir);
  if (process.env.INTEROP_UPDATE === "1") writeFileSync(file, bytes);
  expect(comparable(name, readFileSync(file))).toEqual(comparable(name, bytes));
}
