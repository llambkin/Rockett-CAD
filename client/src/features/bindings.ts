import {
  bindingHolds,
  resolvedFeatureIn,
  type CadDocument,
  type Feature,
  type ParameterBinding,
} from "@rockett/shared";
import { api } from "../api";
import { committedLinks } from "../previewBase";
import { useStore } from "../store";

export type FieldExpressions = Readonly<Record<string, string | null>>;

export function resolvedFeature<F extends Feature>(f: F): F {
  const doc = useStore.getState().document;
  return doc ? resolvedFeatureIn(doc, f) : f;
}

export function storedExpression(
  doc: Pick<CadDocument, "parameterBindings"> | null,
  featureId: string | undefined,
  path: string,
): string | undefined {
  return doc?.parameterBindings.find(
    (b) => b.featureId === featureId && b.path === path,
  )?.expression;
}

function nextBindings(
  doc: Pick<CadDocument, "parameterBindings">,
  feature: Feature,
  expressions: FieldExpressions | undefined,
): ParameterBinding[] | null {
  const own = doc.parameterBindings.filter((b) => b.featureId === feature.id);
  const kept = new Map(own.map((b) => [b.path, b.expression]));
  for (const [path, expression] of Object.entries(expressions ?? {}))
    if (expression === null) kept.delete(path);
    else kept.set(path, expression);
  const next = [...kept]
    .filter(([path]) => bindingHolds(feature, path))
    .map(([path, expression]) => ({ featureId: feature.id, path, expression }));
  const same =
    next.length === own.length &&
    next.every((b) =>
      own.some((o) => o.path === b.path && o.expression === b.expression),
    );
  if (same) return null;
  return [
    ...doc.parameterBindings.filter((b) => b.featureId !== feature.id),
    ...next,
  ];
}

const picked = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "sig" ? undefined : v));

function featureChanges(stored: Feature | undefined, patch: Partial<Feature>) {
  const was: Record<string, unknown> = { targets: [], ...stored };
  return Object.entries({ targets: [], body: undefined, ...patch }).some(
    ([k, v]) => picked(was[k]) !== picked(v),
  );
}

function stagedLinks(
  feature: Feature,
  expressions: FieldExpressions | undefined,
): { links?: ParameterBinding[]; relinked: boolean } {
  const doc = useStore.getState().document;
  if (!doc) return { relinked: false };
  const parameterBindings = committedLinks(doc);
  const next = nextBindings({ parameterBindings }, feature, expressions);
  return { links: next ?? parameterBindings, relinked: next !== null };
}

export async function previewLinked(
  fid: string,
  patch: Partial<Feature>,
  expressions: FieldExpressions | undefined,
  edited?: Feature,
): Promise<void> {
  const s = useStore.getState();
  const stored = s.document?.features.find((f) => f.id === fid);
  const { links, relinked } = stagedLinks(
    edited ?? ({ ...stored, ...patch } as Feature),
    expressions,
  );
  if (relinked || featureChanges(stored, patch))
    return s.updateFeaturePreview(fid, patch, links);
}

export function saveEdit(
  fid: string,
  stored: Feature | undefined,
  patch: Partial<Feature>,
  expressions: FieldExpressions | undefined,
  edited = { ...stored, ...patch } as Feature,
): Promise<void> | null {
  const { links, relinked } = stagedLinks(edited, expressions);
  if (!relinked && !featureChanges(stored, patch)) return null;
  return useStore.getState().updateFeature(fid, patch, links);
}

export function saveNew(
  feature: Feature,
  expressions: FieldExpressions | undefined,
): Promise<void> {
  const s = useStore.getState();
  const doc = s.document && { parameterBindings: committedLinks(s.document) };
  const bindings = doc && nextBindings(doc, feature, expressions);
  return bindings ? saveBound(feature, bindings) : s.addFeature(feature);
}

async function saveBound(
  feature: Feature,
  parameterBindings: ParameterBinding[],
): Promise<void> {
  const s = useStore.getState();
  await s.cancelPreview();
  const doc = useStore.getState().document;
  if (!doc) return;
  await s.mutate(async (tx) => {
    await api.addFeature(doc.id, feature, tx, 1);
    await api.updateParameters(
      doc.id,
      { parameters: doc.parameters, parameterBindings },
      { tx, seq: 2 },
    );
    return api.commitPreview(doc.id, tx);
  });
}
