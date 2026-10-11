import {
  parentPort,
  receiveMessageOnPort,
  type Transferable,
} from "node:worker_threads";
import { initKernel, kernelVersion } from "../geometry/kernel.js";
import {
  dropEngine,
  engineFor,
  type EvaluateHooks,
} from "../geometry/engine.js";
import { installFeatureBundle } from "../modules/features.js";
import { InProcessKernel } from "./client.js";
import {
  fromWire,
  meshesToWire,
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
const installed = new Map<string, () => void>();

let busy = 0;
const waiting: Array<() => void> = [];

function settle() {
  busy--;
  if (busy === 0) waiting.splice(0).forEach((wake) => wake());
}

const idle = async () => {
  let queued;
  while ((queued = receiveMessageOnPort(port)))
    receive(queued.message as ToWorker);
  settle();
  while (busy > 0) await new Promise<void>((wake) => waiting.push(wake));
  busy++;
};

function ask(id: number, held: string[]): Promise<Payload> {
  return new Promise((resolve, reject) => {
    asks.set(id, (settled) =>
      settled.ok ? resolve(settled.value) : reject(fromWire(settled.error)),
    );
    post({ type: "ask", id, held });
  });
}

function kernelFor(id: number) {
  return new InProcessKernel(
    {
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
    },
    idle,
  );
}

async function uploadBytes(id: number) {
  const given = await ask(id, []);
  if (!(given instanceof ArrayBuffer))
    throw new Error("the kernel worker asked for bytes, not sources");
  return Buffer.from(given);
}

const reporting = (id: number, stop: Int32Array): EvaluateHooks => ({
  onProgress: (...args) => post({ type: "progress", id, args }),
  shouldStop: () => Atomics.load(stop, 0) !== 0,
});

const RUN: {
  [M in Method]: (
    id: number,
    ...args: Calls[M]["args"]
  ) => Promise<Calls[M]["result"]>;
} = {
  evaluate: async (id, doc, position, extra, stop) =>
    meshesToWire(
      await kernelFor(id).evaluate(doc, position, extra, {
        onFeatureStart: (...args) => post({ type: "featureStart", id, args }),
        ...reporting(id, stop),
      }),
    ),
  stateQuery: (id, doc, query) => kernelFor(id).stateQuery(doc, query),
  defaultTargets: (id, ...args) => kernelFor(id).defaultTargets(...args),
  signResolved: (id, ...args) => kernelFor(id).signResolved(...args),
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
  moduleJob: (id, entry, job, input, stop) =>
    kernelFor(id).moduleJob(entry, job, input, reporting(id, stop)),
  async features(_id, bundles) {
    const wanted = new Map(
      bundles.map((bundle) => [
        JSON.stringify([bundle.moduleId, bundle.entry, bundle.type]),
        bundle,
      ]),
    );
    for (const [key, dispose] of installed)
      if (!wanted.has(key)) {
        installed.delete(key);
        dispose();
      }
    const failures: unknown[] = [];
    for (const [key, bundle] of wanted)
      if (!installed.has(key))
        await installFeatureBundle(bundle, true).then(
          (dispose) => installed.set(key, dispose),
          (error: unknown) => failures.push(error),
        );
    if (failures.length) throw failures[0];
  },
};

const TRANSFER: {
  [M in Method]?: (value: Calls[M]["result"]) => Transferable[];
} = {
  evaluate: ({ bodies }) =>
    bodies.flatMap(({ binary, coarseBinary }) =>
      coarseBinary ? [binary, coarseBinary] : [binary],
    ),
  export: ({ data }) => [data],
};

const booted = initKernel().then(() =>
  post({ type: "ready", version: kernelVersion() }),
);

let installing: Promise<unknown> = Promise.resolve();

async function serve({ id, method, args }: Call) {
  busy++;
  await booted;
  const run = RUN[method] as (
    id: number,
    ...args: Calls[Method]["args"]
  ) => Promise<Calls[Method]["result"]>;
  const transfer = TRANSFER[method] as
    ((value: Calls[Method]["result"]) => Transferable[]) | undefined;
  const result = installing.then(() => run(id, ...args));
  if (method === "features") installing = result.catch(() => undefined);
  try {
    const value = await result;
    post(
      { type: "reply", id, settled: { ok: true, value } },
      transfer?.(value),
    );
  } catch (error) {
    post({ type: "reply", id, settled: { ok: false, error: toWire(error) } });
  } finally {
    asks.delete(id);
    settle();
  }
}

function receive(message: ToWorker) {
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
}

port.on("message", receive);
