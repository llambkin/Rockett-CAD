import { loadavg } from "node:os";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import type { CadDocument, Feature } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { tessellateBody } from "../src/geometry/tessellate.js";
import { manyFeaturePart } from "./helpers/perfFixtures.js";

setFlagsFromString("--expose-gc");
const gc: () => void = runInNewContext("gc");

const CYCLES = Number(process.env.ROCKETT_SOAK_CYCLES ?? 300);
const EVERY = 100;
const REWIND = 3;
const POCKETS = 25;
const mb = (bytes: number) => Math.round(bytes / 2 ** 20);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Handle = { $$: { ptr?: number; smartPtr?: number; ptrType: any } };
type Holding = { name: string; smart: boolean; deleted: boolean };

function trackHandles(oc: Record<string, any>) {
  const count = { live: 0, orphaned: 0, finalized: 0 };
  const byClass = new Map<string, number>();
  const holdings = new WeakMap<object, Holding>();
  const bump = (name: string, by: number) =>
    byClass.set(name, (byClass.get(name) ?? 0) + by);
  const release = (holding: Holding) => {
    count.live--;
    bump(holding.name, -1);
  };
  const collected = new FinalizationRegistry<Holding>((holding) => {
    if (holding.deleted) return;
    if (holding.smart) {
      count.finalized++;
      release(holding);
    } else count.orphaned++;
  });
  const track = (value: unknown) => {
    const handle = value as Handle | undefined;
    if (handle?.$$?.ptr && !holdings.has(handle)) {
      const holding = {
        name: handle.$$.ptrType.registeredClass.name,
        smart: Boolean(handle.$$.smartPtr),
        deleted: false,
      };
      holdings.set(handle, holding);
      collected.register(handle, holding, handle);
      count.live++;
      bump(holding.name, 1);
    }
    return value;
  };
  const wrapAll = (target: any, skip: Set<string>) => {
    for (const [key, desc] of Object.entries(
      Object.getOwnPropertyDescriptors(target),
    )) {
      if (skip.has(key) || typeof desc.value !== "function" || !desc.writable)
        continue;
      const fn = desc.value;
      target[key] = Object.assign(function (this: unknown, ...args: any[]) {
        return track(fn.apply(this, args));
      }, fn);
    }
  };

  let base = oc.TopoDS_Shape.prototype;
  while (!Object.hasOwn(base, "isAliasOf")) base = Object.getPrototypeOf(base);
  const del = base.delete;
  base.delete = function (this: Handle) {
    del.call(this);
    const holding = holdings.get(this);
    if (holding && !holding.deleted) {
      holding.deleted = true;
      collected.unregister(this);
      release(holding);
    }
  };

  const seen = new Set<object>([base]);
  const protoSkip = new Set([
    "constructor",
    "delete",
    "isDeleted",
    "isAliasOf",
  ]);
  const staticSkip = new Set(["prototype", "length", "name"]);
  wrapAll(base, protoSkip);
  for (const [name, ctor] of Object.entries(oc)) {
    if (typeof ctor !== "function" || !base.isPrototypeOf(ctor.prototype))
      continue;
    for (
      let proto = ctor.prototype;
      !seen.has(proto);
      proto = Object.getPrototypeOf(proto)
    ) {
      seen.add(proto);
      wrapAll(proto, protoSkip);
    }
    wrapAll(ctor, staticSkip);
    oc[name] = new Proxy(ctor, {
      construct: (target, args) => track(new target(...args)) as object,
    });
  }

  let before = new Map<string, number>();
  const grown = () => {
    const top = [...byClass]
      .map(([name, n]): [string, number] => [name, n - (before.get(name) ?? 0)])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    before = new Map(byClass);
    return top;
  };
  return { count, grown };
}

function editTail(doc: CadDocument, radius: number): CadDocument {
  const last = doc.features.length - 1;
  return {
    ...doc,
    features: doc.features.map((f, i): Feature =>
      i === last && f.type === "fillet" ? { ...f, radius } : f,
    ),
  };
}

it(
  "samples memory across edit-tail, rewind and tessellate cycles",
  async () => {
    const oc = await initKernel();
    const handles = trackHandles(oc);
    const doc = manyFeaturePart(POCKETS);
    const edited = editTail(doc, 0.6);
    const end = doc.features.length;
    const samples: Record<string, number | string>[] = [];
    let started = performance.now();

    const sample = async (phase: string, cycle: number, engine = true) => {
      const seconds = (performance.now() - started) / 1000;
      for (let i = 0; i < 2; i++) {
        gc();
        await settle();
      }
      const cache = engine ? engineFor(doc.id) : undefined;
      const row = {
        phase,
        cycle,
        seconds: Math.round(seconds),
        load1: Number(loadavg()[0]!.toFixed(1)),
        rssMb: mb(process.memoryUsage().rss),
        jsHeapMb: mb(process.memoryUsage().heapUsed),
        wasmHeapMb: mb(oc.HEAPU8.byteLength),
        liveHandles: handles.count.live,
        orphanedHandles: handles.count.orphaned,
        finalizedHandles: handles.count.finalized,
        snapshots: cache?.["snapshots"].length ?? 0,
        tessEntries: cache?.["tessCache"].size ?? 0,
      };
      samples.push(row);
      process.stdout.write(`memory soak ${JSON.stringify(row)}\n`);
      started = performance.now();
    };

    await sample("kernel", 0, false);
    const cold = engineFor(doc.id).evaluate(doc);
    expect(cold.featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
    await sample("cold", end);
    const grown = (phase: string) =>
      process.stdout.write(
        `memory soak ${phase} handles by class ${JSON.stringify(handles.grown())}\n`,
      );
    grown("cold");
    const tip = () => engineFor(doc.id).stateAt(doc).bodies.get("b:base")!;

    const phases: [string, (cycle: number) => void][] = [
      [
        "edit-tail",
        (cycle) => engineFor(doc.id).evaluate(cycle % 2 ? edited : doc),
      ],
      [
        "rewind",
        () => {
          engineFor(doc.id).evaluate(doc, end - REWIND);
          engineFor(doc.id).evaluate(doc);
        },
      ],
      [
        "tessellate",
        () => tessellateBody(tip(), { name: "base", visible: true }),
      ],
    ];
    for (const [phase, run] of phases) {
      await sample(phase, 0);
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        run(cycle);
        if (cycle % EVERY === 0 || cycle === CYCLES) await sample(phase, cycle);
      }
      grown(phase);
    }

    dropEngine(doc.id);
    await sample("dropEngine", 0, false);

    for (const row of samples)
      for (const value of Object.values(row))
        if (typeof value === "number")
          expect(Number.isFinite(value)).toBe(true);
    expect(samples.filter((s) => s.phase === "edit-tail").length).toBe(
      Math.ceil(CYCLES / EVERY) + 1,
    );
  },
  (15 + CYCLES / 10) * 60_000,
);
