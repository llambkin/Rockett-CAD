import { SCHEMA_VERSION, type CadDocument } from "@rockett/shared";

type Value = Record<string, unknown>;

export interface MigrationContext {
  put(bytes: Uint8Array): string;
  asset(name: string): Uint8Array | undefined;
}

export interface Migrations<T> {
  namespace: string;
  current: number;
  field: keyof T & string;
  steps: Record<number, (value: Value, context: MigrationContext) => Value>;
}

export const NO_BLOBS: MigrationContext = {
  put() {
    throw new Error("this migration needs a blob store");
  },
  asset() {
    throw new Error("this migration needs a blob store");
  },
};

export class MissingStepError extends Error {
  constructor(
    readonly namespace: string,
    readonly from: unknown,
    readonly current: number,
  ) {
    super(
      `no ${namespace} migration from version ${String(from)} to ${current}`,
    );
  }
}

export class TooNewError extends Error {
  constructor(
    readonly namespace: string,
    readonly version: number,
    readonly current: number,
  ) {
    super(
      `${namespace} version ${version} is newer than this server reads (${current}); upgrade the application`,
    );
  }
}

export function migrate<T>(
  table: Migrations<T>,
  value: unknown,
  context: MigrationContext = NO_BLOBS,
): T {
  const record = (typeof value === "object" && value ? value : {}) as Value;
  const version = record[table.field];
  if (typeof version !== "number" || !Number.isInteger(version))
    throw new MissingStepError(table.namespace, version, table.current);
  if (version > table.current)
    throw new TooNewError(table.namespace, version, table.current);
  let current = record;
  for (let from = version; from < table.current; from++) {
    const step = table.steps[from];
    if (!step) throw new MissingStepError(table.namespace, from, table.current);
    current = { ...step(current, context), [table.field]: from + 1 };
  }
  return current as T;
}

function stepBlob(feature: Value, context: MigrationContext): Value {
  const { data, ...rest } = feature;
  if (typeof data !== "string") return feature;
  return { ...rest, blob: context.put(Buffer.from(data, "utf8")) };
}

function imageBlob(feature: Value, context: MigrationContext): Value {
  const bytes =
    typeof feature.assetId === "string"
      ? context.asset(feature.assetId)
      : undefined;
  return bytes ? { ...feature, assetId: context.put(bytes) } : feature;
}

export const documentMigrations: Migrations<CadDocument> = {
  namespace: "document",
  current: SCHEMA_VERSION,
  field: "schemaVersion",
  steps: {
    1: (doc) => doc,
    2: (doc) => doc,
    3: (doc) => doc,
    4: (doc) => doc,
    5: (doc) => ({ ...doc, groups: [] }),
    6: (doc) => ({ ...doc, revision: 0, savedWith: null }),
    7: (doc, context) => ({
      ...doc,
      features: (doc.features as Value[]).map((feature) =>
        feature.type === "importStep" ? stepBlob(feature, context) : feature,
      ),
    }),
    8: (doc, context) => ({
      ...doc,
      features: (doc.features as Value[]).map((feature) =>
        feature.type === "referenceImage"
          ? imageBlob(feature, context)
          : feature,
      ),
    }),
    9: (doc) => ({ ...doc, extensions: doc.extensions ?? {} }),
  },
};
