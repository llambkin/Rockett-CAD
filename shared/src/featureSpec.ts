import type { TProperties, TSchema } from "typebox";
import type {
  AxisRef,
  CadDocument,
  EdgeRef,
  ExtensionFeature,
  ExtensionType,
  FaceRef,
  Feature,
  FeatureType,
  PlaneRef,
  PointRef,
  ProfileRef,
} from "./model.js";
import { createRegistry } from "./registry.js";
import { extensionFeatureSchema, FEATURE_SCHEMAS } from "./schema/features.js";
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

export function featureInputs(f: Feature) {
  const bodies = new Set<string>();
  const features = new Set<string>();
  const topology: Array<[string, FaceRef | EdgeRef]> = [];
  const topo = (path: string, ref: FaceRef | EdgeRef) => {
    bodies.add(ref.bodyId);
    if (
      (ref.kind === "face" && typeof ref.faceName === "string") ||
      (ref.kind === "edge" && typeof ref.edgeName === "string")
    )
      topology.push([path, ref]);
  };
  for (const ref of featureSpec(f.type)?.refs(f) ?? []) {
    switch (ref.kind) {
      case "face":
        topo(ref.path, ref.face);
        break;
      case "edge":
        topo(ref.path, ref.edge);
        break;
      case "body":
        bodies.add(ref.body);
        break;
      case "sketch":
        features.add(ref.sketch);
        break;
      case "profile":
        features.add(ref.profile.sketchId);
        break;
      case "plane":
        if (ref.plane.kind === "face") topo(`${ref.path}/face`, ref.plane.face);
        else if (ref.plane.kind === "construction")
          features.add(ref.plane.featureId);
        break;
      case "axis":
        if (ref.axis.kind === "edge") topo(`${ref.path}/edge`, ref.axis.edge);
        else if (ref.axis.kind === "sketchLine")
          features.add(ref.axis.sketchId);
        break;
      case "point":
        if (ref.point.kind === "vertex") bodies.add(ref.point.bodyId);
        else features.add(ref.point.sketchId);
        break;
    }
  }
  return { bodies: [...bodies], features: [...features], topology };
}

export const inputBodies = (f: Feature) => featureInputs(f).bodies;
export const inputFeatures = (f: Feature) => featureInputs(f).features;

export function nextFeatureName(doc: CadDocument, type: string): string {
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

export function registerExtensionSpec<P extends TSchema>({
  type,
  label,
  version,
  params,
  migrate,
}: {
  type: ExtensionType;
  label: string;
  version: number;
  params: P;
  migrate?: (fromVersion: number, f: ExtensionFeature) => ExtensionFeature;
}): () => void {
  const schema = extensionFeatureSchema(type, version, params);
  const spec: FeatureSpec<ExtensionFeature> = {
    type,
    label,
    producesGeometry: true,
    version,
    paramsSchema: schema,
    validate: (f) => {
      parse(schema, f);
    },
    refs: () => [],
    displayOnly: [],
    ...(migrate && { migrate }),
  };
  return registerFeatureSpec(spec);
}
