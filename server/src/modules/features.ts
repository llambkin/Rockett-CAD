import type { TimelineFeature } from "@rockett/plugin-api";
import {
  featureModule,
  moduleBodyId,
  NAME_LENGTH,
  REGISTRY_ID,
  registerExtensionSpec,
  type ExtensionFeature,
} from "@rockett/shared";
import { withinImportBudget } from "../api/importers.js";
import { engineCache } from "../geometry/engine.js";
import {
  registerFeatureKind,
  type FeatureKind,
} from "../geometry/featureKinds.js";
import {
  registerBodySolids,
  rejectInvalidBody,
} from "../geometry/featureState.js";
import {
  acquire,
  cancelRequested,
  faces,
  getKernel,
  scoped,
  solids,
  type Own,
  type Shape,
} from "../geometry/kernel.js";
import { ShapeMap } from "../geometry/shapeMap.js";
import { sourceNames } from "../geometry/signature.js";
import { readXdeStep } from "../geometry/xde.js";
import { IMPORT_LIMITS } from "../tunables.js";

export interface FeatureBundle {
  moduleId: string;
  entry: string;
  type: string;
}

export function checkModuleType(moduleId: string, type: string, what: string) {
  if (!type.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(type))
    throw new Error(
      `${what} ${type} must start with ${moduleId}. and name a valid id`,
    );
  if (featureModule(type) !== moduleId)
    throw new Error(`${what} ${type} must belong to module ${moduleId}`);
}

export function synchronous<T>(result: T, what: string): T {
  if (
    result instanceof Object &&
    typeof Reflect.get(result, "then") === "function"
  ) {
    Promise.resolve(result).catch((error: unknown) =>
      console.error(`[rockett] ${what} failed after it was refused`, error),
    );
    throw new Error(`${what} must return synchronously, not a promise`);
  }
  return result;
}

const LABEL = /^[a-z0-9][a-z0-9_:-]{0,63}$/;

function labelsOf(own: Own, shape: Shape, listed: unknown, what: string) {
  const oc = getKernel();
  if (!Array.isArray(listed))
    throw new Error(`${what} face labels must be a list`);
  const labels = new ShapeMap<string>();
  own({ delete: () => labels.release() });
  const seen = new Set<string>();
  for (const entry of listed) {
    const [face, label] = Array.isArray(entry) ? entry : [];
    if (typeof label !== "string" || !LABEL.test(label))
      throw new Error(
        `${what} face label ${JSON.stringify(String(label).slice(0, 64))} is invalid`,
      );
    if (!(face instanceof oc.TopoDS_Shape) || own(face).isDeleted())
      throw new Error(`${what} labels a face it did not emit`);
    if (seen.has(label)) throw new Error(`${what} labels two faces ${label}`);
    if (labels.get(face) !== undefined)
      throw new Error(`${what} labels one face twice`);
    seen.add(label);
    labels.set(face, label);
  }
  const found = faces(shape).filter((face) => labels.get(face) !== undefined);
  if (found.length !== labels.size)
    throw new Error(`${what} labels a face it did not emit`);
  return labels;
}

function readStep(bytes: unknown, what: string) {
  if (!(bytes instanceof Uint8Array))
    throw new Error(`${what} readStep takes a Uint8Array`);
  withinImportBudget({ size: bytes.byteLength }, IMPORT_LIMITS.importBytes);
  return readXdeStep(bytes).bodies.map(({ shape }) => shape);
}

const KEY = /^[a-z0-9][a-z0-9_:-]{0,127}$/;

function keyedBodies(listed: unknown, what: string) {
  if (listed === undefined) return [];
  if (!Array.isArray(listed)) throw new Error(`${what} bodies must be a list`);
  const keys = new Set<string>();
  return listed.map((entry) => {
    const {
      key,
      name,
      shape,
      faces: labels = [],
      reference = false,
      approximate = false,
    } = Object(entry);
    if (typeof key !== "string" || !KEY.test(key))
      throw new Error(
        `${what} body key ${JSON.stringify(String(key).slice(0, 128))} is invalid`,
      );
    if (keys.has(key)) throw new Error(`${what} returns body ${key} twice`);
    keys.add(key);
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > NAME_LENGTH ||
      /\p{Cc}/u.test(name)
    )
      throw new Error(`${what} body ${key} name is invalid`);
    if (typeof reference !== "boolean" || typeof approximate !== "boolean")
      throw new Error(`${what} body ${key} flags must be true or false`);
    return { key, name, shape, labels, reference, approximate };
  });
}

function namedSolid(
  own: Own,
  body: Shape,
  listed: unknown,
  kind: string,
  what: string,
  featureId: string,
) {
  if (!(body instanceof getKernel().TopoDS_Shape))
    throw new Error(`${what} must return a solid shape`);
  own(body);
  if (body.isDeleted() || solids(body).length === 0)
    throw new Error(`${what} must return a solid shape`);
  rejectInvalidBody(kind, body);
  const names = sourceNames(body, featureId, labelsOf(own, body, listed, what));
  own.keep(own({ delete: () => names.release() }));
  return { shape: own.keep(body), names };
}

function kindOf({ spec, evaluate }: TimelineFeature): FeatureKind {
  const what = `timeline feature ${spec.type}`;
  const moduleId = featureModule(spec.type)!;
  return {
    type: spec.type,
    evaluate({ state, sources, inputs }, feature) {
      const oc = getKernel();
      const { made, keyed } = scoped((own) => {
        const result: Shape = synchronous(
          evaluate({
            oc,
            own,
            progress() {
              if (cancelRequested()) throw new Error(`${what} cancelled`);
            },
            readStep: (bytes) => readStep(bytes, what),
            params: structuredClone((feature as ExtensionFeature).params),
            ...(inputs && {
              inputs: {
                identity: inputs.identity,
                assets: inputs.assets.map((hash) => sources.get(hash)!.slice()),
              },
            }),
          }),
          what,
        );
        const {
          shape,
          faces: listed = [],
          bodies,
        }: Shape = result instanceof oc.TopoDS_Shape
          ? { shape: result }
          : Object(result);
        const named = (body: Shape, labels: unknown, label: string) =>
          namedSolid(own, body, labels, spec.label, label, feature.id);
        return {
          made: named(shape, listed, what),
          keyed: keyedBodies(bodies, what).map((entry) => {
            const id = moduleBodyId(moduleId, feature.id, entry.key);
            const label = `${what} body ${entry.key}`;
            const solid = named(entry.shape, entry.labels, label);
            if (solids(solid.shape).length !== 1)
              throw new Error(`${label} must be one solid`);
            if (state.bodies.has(id))
              throw new Error(`${what} body ${id} already exists`);
            return { ...entry, ...solid, id };
          }),
        };
      });
      acquire(made.shape);
      registerBodySolids(state, `b:${feature.id}`, made.shape, made.names);
      for (const { id, name, reference, approximate, shape, names } of keyed) {
        acquire(shape);
        registerBodySolids(state, id, shape, names);
        state.imported.set(id, {
          name,
          ...(reference && { reference }),
          ...(approximate && { approximate }),
        });
      }
    },
  };
}

export async function installFeatureBundle(
  { moduleId, entry, type }: FeatureBundle,
  withSpecs: boolean,
): Promise<() => void> {
  checkModuleType(moduleId, type, "timeline feature");
  const { features } = (await import(entry)) as { features?: unknown };
  if (!Array.isArray(features))
    throw new Error(`${entry} has no timeline feature list`);
  const feature = (features as TimelineFeature[]).find(
    (listed) => listed?.spec?.type === type,
  );
  if (typeof feature?.evaluate !== "function" || !feature.spec)
    throw new Error(`${entry} has no timeline feature ${type}`);
  const disposers: Array<() => void> = [];
  const dispose = () => {
    for (const undo of disposers.splice(0).toReversed()) undo();
    engineCache.clear();
  };
  try {
    if (withSpecs) disposers.push(registerExtensionSpec(feature.spec));
    disposers.push(registerFeatureKind(kindOf(feature)));
  } catch (error) {
    dispose();
    throw error;
  }
  engineCache.clear();
  return dispose;
}
