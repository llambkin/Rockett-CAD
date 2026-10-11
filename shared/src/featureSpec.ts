import { Type, type Static, type TProperties, type TSchema } from "typebox";
import type {
  AutoTargets,
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
  SketchEntityRef,
} from "./model.js";
import type { FeatureInputResolver } from "./featureInputs.js";
import { createRegistry, REGISTRY_ID } from "./registry.js";
import {
  extensionFeatureSchema,
  FEATURE_SCHEMAS,
  featureNameSchema,
} from "./schema/coreFeatures.js";
import { featureIdSchema } from "./schema/refs.js";
import { parse } from "./schema/validation.js";

interface RefTargets {
  face: FaceRef;
  edge: EdgeRef;
  profile: ProfileRef;
  axis: AxisRef;
  plane: PlaneRef;
  point: PointRef;
  body: string;
  sketch: string;
  sketchEntity: SketchEntityRef;
  feature: string;
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
  resolveInputs?: FeatureInputResolver<
    F extends ExtensionFeature<infer P> ? P : never
  >;
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

export const CORE_NAMESPACES = ["design", "sketch", "inspect", "asm"];

export function featureModule(type: string): string | undefined {
  const namespace = REGISTRY_ID.exec(type)?.[1];
  if (!namespace || CORE_NAMESPACES.includes(namespace)) return undefined;
  return type.slice(0, type.lastIndexOf("."));
}

export function newerFeature(f: Feature): string | undefined {
  const spec = featureSpec(f.type);
  const version = "version" in f ? f.version : undefined;
  if (!spec || typeof version !== "number" || version <= spec.version)
    return undefined;
  return `${f.type} version ${version} is newer than this module reads (${spec.version})`;
}

export const opaqueFeature = (f: Feature): boolean =>
  featureSpec(f.type)
    ? newerFeature(f) !== undefined
    : featureModule(f.type) !== undefined;

export function featureRefs(f: Feature): FeatureRef[] {
  if (opaqueFeature(f)) return [];
  return specOf(f.type).refs(f);
}

export const unloadedFeatureSchema = Type.Object({
  id: featureIdSchema,
  type: Type.String({ pattern: REGISTRY_ID.source }),
  name: featureNameSchema,
  suppressed: Type.Boolean(),
  version: Type.Integer({ minimum: 0 }),
  params: Type.Unknown(),
});

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
      case "sketchEntity":
        features.add(ref.sketchEntity.sketchId);
        break;
      case "feature":
        features.add(ref.feature);
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

export const toolTargetRefs = (f: {
  targets?: string[];
  autoTargets?: AutoTargets;
}) => [
  ...refsAt("body", "/targets", f.targets),
  ...refsAt("body", "/autoTargets/exclude", f.autoTargets?.exclude),
  ...refsAt("feature", "/autoTargets/features", f.autoTargets?.features),
];

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

export interface ExtensionSpec<P extends TSchema> {
  type: ExtensionType;
  label: string;
  version: number;
  params: P;
  migrate?: (fromVersion: number, f: ExtensionFeature) => ExtensionFeature;
  resolveInputs?: FeatureInputResolver<Static<P>>;
}

export function registerExtensionSpec<P extends TSchema>({
  type,
  label,
  version,
  params,
  migrate,
  resolveInputs,
}: ExtensionSpec<P>): () => void {
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
    ...(resolveInputs && {
      resolveInputs: resolveInputs as FeatureInputResolver,
    }),
  };
  return registerFeatureSpec(spec);
}
