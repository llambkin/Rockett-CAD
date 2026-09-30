import {
  compareNames,
  featureSpec,
  MANIFEST_VERSION,
  SCHEMA_VERSION,
  UNITS_LENGTH,
  VIEW_VERSION,
  type CadDocument,
  type FeatureSpec,
  type ProjectManifest,
  type ProjectView,
  type Visibility,
} from "@rockett/shared";

type Value = Record<string, unknown>;

export interface MigrationContext {
  put(bytes: Uint8Array): string;
  asset(name: string): Uint8Array | undefined;
  show(visibility: Visibility): void;
  setting(key: string, value: unknown): void;
}

export interface Migrations<T> {
  namespace: string;
  current: number;
  field: keyof T & string;
  steps: Record<number, (value: Value, context: MigrationContext) => Value>;
  nested?: (value: Value) => Value;
}

export const NO_BLOBS: MigrationContext = {
  put() {
    throw new Error("this migration needs a blob store");
  },
  asset() {
    throw new Error("this migration needs a blob store");
  },
  show() {
    throw new Error("this migration needs a view store");
  },
  setting() {},
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
  return (table.nested?.(current) ?? current) as T;
}

function featureMigrations({
  type,
  version,
  migrate: step,
}: FeatureSpec): Migrations<Value> {
  const steps: Migrations<Value>["steps"] = {};
  if (step)
    for (let from = 1; from < version; from++)
      steps[from] = (feature) => ({ ...step(from, feature as never) });
  return { namespace: type, current: version, field: "version", steps };
}

function extensionFeatures(doc: Value): Value {
  const features = doc.features;
  if (!Array.isArray(features)) return doc;
  const migrated = features.map((feature: Value) => {
    const spec =
      typeof feature.type === "string" && feature.type.includes(".")
        ? featureSpec(feature.type)
        : undefined;
    return spec ? migrate(featureMigrations(spec), feature) : feature;
  });
  return migrated.every((feature, i) => feature === features[i])
    ? doc
    : { ...doc, features: migrated };
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

function sortedJoinTargets(feature: Value): Value {
  const joins =
    feature.type === "emboss"
      ? feature.mode === "emboss"
      : feature.operation === "join";
  return joins && Array.isArray(feature.targets)
    ? {
        ...feature,
        targets: (
          feature.targets as unknown as {
            toSorted(compare: typeof compareNames): string[];
          }
        ).toSorted(compareNames),
      }
    : feature;
}

export function splitView(doc: Value): { doc: Value; shown: Visibility } {
  const shown: Visibility = { bodies: {}, features: {} };
  const bodyMeta = Object.entries(
    (doc.bodyMeta ?? {}) as Record<string, Value>,
  ).map(([id, { visible, ...meta }]) => {
    if (typeof visible === "boolean") shown.bodies[id] = visible;
    return [id, meta];
  });
  const features = ((doc.features ?? []) as Value[]).map(
    ({ visible, ...feature }) => {
      if (typeof visible === "boolean")
        shown.features[String(feature.id)] = visible;
      return feature;
    },
  );
  const { camera: _camera, ...rest } = doc;
  return {
    doc: { ...rest, bodyMeta: Object.fromEntries(bodyMeta), features },
    shown,
  };
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
    10: (doc, context) => {
      const split = splitView(doc);
      context.show(split.shown);
      return split.doc;
    },
    11: (doc) => ({ ...doc, namingVersion: 1 }),
    12: (doc) => ({
      ...splitView(doc).doc,
      ...(!Object.hasOwn(doc, "namingVersion") && { namingVersion: 1 }),
    }),
    13: (doc) => doc,
    14: (doc) => doc,
    15: (doc) => doc,
    16: (doc) => doc,
    17: (doc) => doc,
    18: ({ units, ...doc }, context) => {
      if (units !== undefined && units !== "mm")
        context.setting(UNITS_LENGTH.key, units);
      return doc;
    },
    19: (doc) =>
      doc.namingVersion === 2
        ? {
            ...doc,
            features: (doc.features as Value[]).map(sortedJoinTargets),
          }
        : doc,
    20: (doc) => ({ ...doc, modifiedBy: null }),
    21: (doc) => doc,
  },
  nested: extensionFeatures,
};

export const viewMigrations: Migrations<ProjectView> = {
  namespace: "view",
  current: VIEW_VERSION,
  field: "version",
  steps: { 1: (view) => ({ ...view, camera: null }) },
};

export const manifestMigrations: Migrations<ProjectManifest> = {
  namespace: "project",
  current: MANIFEST_VERSION,
  field: "version",
  steps: {
    1: (manifest) => ({ ...manifest, owner: null, members: [] }),
  },
};
