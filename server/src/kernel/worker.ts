import { parentPort, type Transferable } from "node:worker_threads";
import { initKernel, kernelVersion } from "../geometry/kernel.js";
import { dropEngine, engineFor } from "../geometry/engine.js";
import { InProcessKernel } from "./client.js";
import {
  fromWire,
  owned,
  toWire,
  type Call,
  type Calls,
  type FromWorker,
  type Method,
  type Payload,
  type Settled,
  type ToWorker,
} from "./protocol.js";

const port = parentPort;
if (!port) throw new Error("the kernel worker runs only as a worker thread");

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  port.postMessage(message, transfer);

const asks = new Map<number, (settled: Settled<Payload>) => void>();

function ask(id: number, held: string[]): Promise<Payload> {
  return new Promise((resolve, reject) => {
    asks.set(id, (settled) =>
      settled.ok ? resolve(settled.value) : reject(fromWire(settled.error)),
    );
    post({ type: "ask", id, held });
  });
}

function kernelFor(id: number) {
  return new InProcessKernel({
    async sources(_doc, held = new Map()) {
      const given = await ask(id, [...held.keys()]);
      if (given instanceof ArrayBuffer)
        throw new Error("the kernel worker asked for sources, not bytes");
      return new Map(
        [...given].flatMap(([hash, bytes]) => {
          const found = bytes ?? held.get(hash);
          return found ? [[hash, found] as const] : [];
        }),
      );
    },
  });
}

async function uploadBytes(id: number) {
  const given = await ask(id, []);
  if (!(given instanceof ArrayBuffer))
    throw new Error("the kernel worker asked for bytes, not sources");
  return Buffer.from(given);
}

const RUN: {
  [M in Method]: (
    id: number,
    ...args: Calls[M]["args"]
  ) => Promise<Calls[M]["result"]>;
} = {
  evaluate: (id, doc, position, extra, stop) =>
    kernelFor(id).evaluate(doc, position, extra, {
      onFeatureStart: (...args) => post({ type: "featureStart", id, args }),
      onProgress: (...args) => post({ type: "progress", id, args }),
      shouldStop: () => Atomics.load(stop, 0) !== 0,
    }),
  stateQuery: (id, doc, query) => kernelFor(id).stateQuery(doc, query),
  visibleTargets: (id, ...args) => kernelFor(id).visibleTargets(...args),
  async export(id, doc, job) {
    const { data, ...file } = await kernelFor(id).export(doc, job);
    return { data: owned(data), ...file };
  },
  formats: (id) => kernelFor(id).formats(),
  importStep: (id, name) =>
    kernelFor(id).importStep(
      name === undefined ? undefined : { name, bytes: () => uploadBytes(id) },
    ),
  planNamingUpgrade: (id, ...args) => kernelFor(id).planNamingUpgrade(...args),
};

const booted = initKernel().then(() =>
  post({ type: "ready", version: kernelVersion() }),
);

async function serve({ id, method, args }: Call) {
  await booted;
  const run = RUN[method] as (
    id: number,
    ...args: Calls[Method]["args"]
  ) => Promise<Calls[Method]["result"]>;
  try {
    const value = await run(id, ...args);
    post(
      { type: "reply", id, settled: { ok: true, value } },
      value !== undefined &&
        "data" in value &&
        value.data instanceof ArrayBuffer
        ? [value.data]
        : [],
    );
  } catch (error) {
    post({ type: "reply", id, settled: { ok: false, error: toWire(error) } });
  } finally {
    asks.delete(id);
  }
}

port.on("message", (message: ToWorker) => {
  switch (message.type) {
    case "call":
      void serve(message);
      return;
    case "payload":
      asks.get(message.id)?.(message.settled);
      asks.delete(message.id);
      return;
    case "drop":
      dropEngine(message.docId);
      return;
    case "quarantine":
      engineFor(message.docId).setQuarantine(message.features);
      return;
  }
});
