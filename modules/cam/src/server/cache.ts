import type { ModuleFiles } from "@rockett/plugin-api";
import { validateProgram, type Program } from "../shared/ir.js";

const MIB = 2 ** 20;
export const CACHE_BYTES = 256 * MIB;
export const MAX_CACHE_BYTES = 384 * MIB;
const FAILURES = 256;

const ENTRY = /^cache\/([0-9a-f]{64})\.json$/;
const entry = (fingerprint: string) => `cache/${fingerprint}.json`;

function parsed(bytes: Uint8Array): Program | undefined {
  try {
    const program = JSON.parse(new TextDecoder().decode(bytes));
    return validateProgram(program).length === 0 ? program : undefined;
  } catch {
    return undefined;
  }
}

function entries(files: ModuleFiles, limit: number) {
  const sizes = new Map<string, number>();
  let total = 0;
  const forget = (fingerprint: string) => {
    total -= sizes.get(fingerprint) ?? 0;
    sizes.delete(fingerprint);
  };
  const add = async (fingerprint: string, bytes: number) => {
    forget(fingerprint);
    sizes.set(fingerprint, bytes);
    total += bytes;
    const gone: string[] = [];
    for (const old of sizes.keys()) {
      if (total <= limit) break;
      if (old === fingerprint) continue;
      gone.push(old);
      forget(old);
    }
    await Promise.all(gone.map((old) => files.remove(entry(old))));
  };
  const load = async () => {
    for (const name of await files.list()) {
      const fingerprint = ENTRY.exec(name)?.[1];
      if (!fingerprint) continue;
      const bytes = await files.read(name);
      if (bytes) await add(fingerprint, bytes.byteLength);
    }
  };
  let loading: Promise<void> | undefined;
  return {
    async read(fingerprint: string) {
      await (loading ??= load());
      const size = sizes.get(fingerprint);
      if (size === undefined) return undefined;
      const bytes = await files.read(entry(fingerprint));
      const program = bytes && parsed(bytes);
      if (program) await add(fingerprint, size);
      else {
        forget(fingerprint);
        await files.remove(entry(fingerprint));
      }
      return program || undefined;
    },
    async write(fingerprint: string, program: Program) {
      const bytes = new TextEncoder().encode(JSON.stringify(program));
      if (bytes.byteLength > limit) return;
      await files.write(entry(fingerprint), bytes);
      await add(fingerprint, bytes.byteLength);
    },
  };
}

export function programCache(files: ModuleFiles, limit = CACHE_BYTES) {
  if (!(Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_CACHE_BYTES))
    throw new RangeError(
      `the CAM program cache holds 1 byte to 384 MiB, not ${limit} bytes`,
    );
  const stored = entries(files, limit);
  const running = new Map<
    string,
    { run: Promise<Program>; signal: AbortSignal | undefined }
  >();
  const failed = new Map<string, string>();

  async function made(
    fingerprint: string,
    make: () => Promise<Program>,
    signal?: AbortSignal,
  ) {
    try {
      const program = await make();
      const [problem] = validateProgram(program);
      if (problem) throw new Error(`generated program is invalid: ${problem}`);
      signal?.throwIfAborted();
      await stored.write(fingerprint, program);
      failed.delete(fingerprint);
      return program;
    } catch (error) {
      if (!signal?.aborted) {
        failed.delete(fingerprint);
        failed.set(
          fingerprint,
          error instanceof Error ? error.message : String(error),
        );
        const [oldest] = failed.keys();
        if (failed.size > FAILURES) failed.delete(oldest!);
      }
      throw error;
    }
  }

  return {
    failure: (fingerprint: string) => failed.get(fingerprint),
    async cached(fingerprint: string) {
      const bytes = await files.read(entry(fingerprint));
      return bytes ? parsed(bytes) : undefined;
    },
    async program(
      fingerprint: string,
      make: () => Promise<Program>,
      signal?: AbortSignal,
    ): Promise<Program> {
      const cached = await stored.read(fingerprint);
      if (cached) return cached;
      for (let shared = running.get(fingerprint); shared;) {
        try {
          return await shared.run;
        } catch (error) {
          signal?.throwIfAborted();
          if (!shared.signal?.aborted) throw error;
          shared = running.get(fingerprint);
        }
      }
      const run = made(fingerprint, make, signal).finally(() =>
        running.delete(fingerprint),
      );
      running.set(fingerprint, { run, signal });
      return run;
    },
  };
}

export type ProgramCache = ReturnType<typeof programCache>;
