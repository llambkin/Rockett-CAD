import {
  coarseOf,
  lazyMesh,
  meshBinary,
  meshHead,
  withCoarse,
  ValidationError,
  type ApiErrorCode,
  type BodyPayload,
  type CadDocument,
  type EvaluateResult,
  type Formats,
  type Health,
  type MeshedEvaluation,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";
import type { Sources } from "../geometry/importers.js";
import type { EvaluateHooks } from "../geometry/engine.js";
import type { CrashFeature } from "../geometry/resolve.js";
import type { FeatureBundle } from "../modules/features.js";
import type {
  ExportJob,
  Imported,
  KernelClient,
  NamingPlan,
  StateAnswers,
  StateQuery,
} from "./client.js";

export interface Calls {
  evaluate: {
    args: [
      doc: CadDocument,
      position: number | undefined,
      extra: Sources | undefined,
      stop: Int32Array,
    ];
    result: WireEvaluation;
  };
  stateQuery: {
    args: [doc: CadDocument, query: StateQuery];
    result: StateAnswers[keyof StateAnswers];
  };
  defaultTargets: {
    args: Parameters<KernelClient["defaultTargets"]>;
    result: Awaited<ReturnType<KernelClient["defaultTargets"]>>;
  };
  signResolved: {
    args: Parameters<KernelClient["signResolved"]>;
    result: Awaited<ReturnType<KernelClient["signResolved"]>>;
  };
  export: {
    args: [doc: CadDocument, job: ExportJob];
    result: { data: ArrayBuffer; mime: string; ext: string };
  };
  formats: { args: []; result: Formats };
  importStep: { args: [name: string | undefined]; result: Imported };
  planNamingUpgrade: {
    args: Parameters<KernelClient["planNamingUpgrade"]>;
    result: NamingPlan;
  };
  moduleJob: {
    args: [entry: string, id: string, input: unknown, stop: Int32Array];
    result: unknown;
  };
  features: { args: [bundles: FeatureBundle[]]; result: void };
}

export type Method = keyof Calls;

type WireBody = BodyPayload & {
  binary: ArrayBuffer;
  coarseBinary?: ArrayBuffer;
};

export interface WireEvaluation extends EvaluateResult {
  bodies: WireBody[];
}

type HeldSources = ReadonlyMap<string, Uint8Array | null>;

export type Payload = HeldSources | ArrayBuffer;

type WireError =
  | { kind: "validation"; message: string; detail?: string }
  | { kind: "store"; message: string; code: ApiErrorCode }
  | { kind: "error"; name: string; message: string; stack?: string };

export type Settled<T> =
  { ok: true; value: T } | { ok: false; error: WireError };

export type Call = {
  [M in Method]: {
    type: "call";
    id: number;
    method: M;
    args: Calls[M]["args"];
  };
}[Method];

export type ToWorker =
  | Call
  | { type: "drop"; docId: string }
  | { type: "quarantine"; docId: string; features: CrashFeature[] }
  | { type: "payload"; id: number; settled: Settled<Payload> };

type HookArgs<K extends keyof EvaluateHooks> = Parameters<
  NonNullable<EvaluateHooks[K]>
>;

export type Report =
  | { type: "featureStart"; id: number; args: HookArgs<"onFeatureStart"> }
  | { type: "progress"; id: number; args: HookArgs<"onProgress"> };

export type FromWorker =
  | Report
  | { type: "ready"; version: Health["kernelVersion"] }
  | { type: "ask"; id: number; held: string[] }
  | { type: "reply"; id: number; settled: Settled<Calls[Method]["result"]> };

export function toWire(error: unknown): WireError {
  if (error instanceof ValidationError)
    return {
      kind: "validation",
      message: error.message,
      ...(error.detail !== undefined && { detail: error.detail }),
    };
  if (error instanceof StoreError)
    return { kind: "store", message: error.message, code: error.code };
  const { name, message, stack } =
    error instanceof Error ? error : new Error(String(error));
  return {
    kind: "error",
    name,
    message,
    ...(stack !== undefined && { stack }),
  };
}

export function fromWire(wire: WireError): Error {
  switch (wire.kind) {
    case "validation":
      return new ValidationError(wire.message, wire.detail);
    case "store":
      return new StoreError(wire.message, wire.code);
    case "error":
      return Object.assign(new Error(wire.message), {
        name: wire.name,
        stack: wire.stack ?? wire.message,
      });
  }
}

export function owned(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer instanceof ArrayBuffer &&
    byteOffset === 0 &&
    byteLength === buffer.byteLength
    ? buffer
    : new Uint8Array(bytes).buffer;
}

export function meshesToWire(evaluation: MeshedEvaluation): WireEvaluation {
  const bodies = evaluation.bodies.map((body) => {
    const coarse = coarseOf(body);
    return {
      ...meshHead(body),
      binary: meshBinary(body).slice().buffer,
      ...(coarse && { coarseBinary: coarse.slice().buffer }),
    };
  });
  return { ...evaluation, bodies };
}

export function meshesFromWire(evaluation: WireEvaluation): MeshedEvaluation {
  const bodies = evaluation.bodies.map(({ binary, coarseBinary, ...body }) =>
    lazyMesh(
      body,
      withCoarse(
        new Uint8Array(binary),
        coarseBinary && new Uint8Array(coarseBinary),
      ),
    ),
  );
  return { ...evaluation, bodies };
}
