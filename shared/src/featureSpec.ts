import type { TProperties, TSchema } from "typebox";
import type {
  AxisRef,
  CadDocument,
  EdgeRef,
  FaceRef,
  Feature,
  FeatureType,
  PlaneRef,
  PointRef,
  ProfileRef,
} from "./model.js";
import { createRegistry } from "./registry.js";
import { FEATURE_SCHEMAS } from "./schema/features.js";
import { parse } from "./schema/index.js";

interface RefTargets {
  face: FaceRef;
  edge: EdgeRef;
  profile: ProfileRef;
  axis: AxisRef;
  plane: PlaneRef;
  point: PointRef;
  body: string;
  sketch: string;
}

type RefKind = keyof RefTargets;

export type FeatureRef = {
  [K in RefKind]: { kind: K; path: string } & Record<K, RefTargets[K]>;
}[RefKind];

export interface FeatureSpec<F extends Feature = Feature> {
  type: string;
  label: string;
  producesGeometry: boolean;
  version: number;
  paramsSchema: TSchema & { properties: TProperties };
  validate(f: F): void;
  refs(f: F): FeatureRef[];
  displayOnly: readonly string[];
  migrate?(fromVersion: number, f: F): F;
}

export const featureSpecs = createRegistry<FeatureSpec>(
  "feature spec",
  (spec) => spec.type,
);

export const registerFeatureSpec = featureSpecs.register;
export const featureSpec = featureSpecs.get;

function specOf(type: string): FeatureSpec {
  const spec = featureSpec(type);
  if (!spec) throw new Error(`no feature spec for ${type}`);
  return spec;
}

export function featureRefs(f: Feature): FeatureRef[] {
  return specOf(f.type).refs(f);
}

export function nextFeatureName(doc: CadDocument, type: FeatureType): string {
  const label = specOf(type).label;
  const n = (doc.counters[type] ?? 0) + 1;
  doc.counters[type] = n;
  return `${label}${n}`;
}

export const refAt = <K extends RefKind>(
  kind: K,
  path: string,
  target: RefTargets[K],
) => ({ kind, path, [kind]: target }) as FeatureRef;

export const refsAt = <K extends RefKind>(
  kind: K,
  path: string,
  targets: readonly RefTargets[K][] = [],
) => targets.map((target, i) => refAt(kind, `${path}/${i}`, target));

export function registerCoreSpec<T extends FeatureType>(
  type: T,
  label: string,
  refs: (f: Extract<Feature, { type: T }>) => FeatureRef[],
  {
    producesGeometry = true,
    check = () => {},
  }: {
    producesGeometry?: boolean;
    check?: (f: Extract<Feature, { type: T }>) => void;
  } = {},
): () => void {
  const schema = FEATURE_SCHEMAS[type];
  const spec: FeatureSpec<Extract<Feature, { type: T }>> = {
    type,
    label,
    producesGeometry,
    version: 1,
    paramsSchema: schema,
    validate: (f) => {
      parse(schema, f);
      check(f);
    },
    refs,
    displayOnly: [],
  };
  return registerFeatureSpec(spec);
}
