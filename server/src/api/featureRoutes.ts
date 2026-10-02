import {
  lacksTargets,
  nextFeatureName,
  pinTargets,
  ROUTES,
  startFirst,
  ValidationError,
  type CadDocument,
  type Feature,
  type User,
  unsignedRefs,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";
import { pruneViews } from "../store/viewStore.js";
import {
  knownKeys,
  record,
  validateBuilt,
  validateFeature,
} from "./validate.js";
import type { ApiRoutes } from "./projectMutations.js";
import { evaluationPosition } from "./evaluationPosition.js";
const KEEPS_TARGETS = new Set(["name", "suppressed"]);

function keepsTargets(patch: object): boolean {
  return (
    !("targets" in patch) &&
    Object.keys(patch).every((key) => KEEPS_TARGETS.has(key))
  );
}

function retargets(patch: object): boolean {
  return !("targets" in patch) && !keepsTargets(patch);
}

function featureEdits(context: ApiRoutes) {
  const { kernel, store } = context;
  async function pinned(
    doc: CadDocument,
    index: number,
    hidden: string[] = [],
  ) {
    const feature = doc.features[index]!;
    if (lacksTargets(feature))
      pinTargets(feature, await kernel.visibleTargets(doc, index, hidden));
  }

  async function written(doc: CadDocument, index: number, user: User) {
    await pinned(doc, index, (await store.view(doc.id, user.id)).hidden.bodies);
    startFirst(doc.features[index]!);
  }

  async function signed(
    doc: CadDocument,
    index: number,
    feature: Feature,
    previous?: Feature,
  ) {
    const refs = unsignedRefs(feature, previous);
    if (!refs.length) return;
    const sigs = await kernel.stateQuery(doc, {
      kind: "sign",
      position: index,
      refs,
    });
    refs.forEach((ref, i) => {
      const sig = sigs[i];
      if (sig) ref.sig = sig;
    });
  }
  return { pinned, written, signed };
}

function addFeatureRoute(context: ApiRoutes) {
  const { on, mutateProject, kernel } = context;
  const { written, signed } = featureEdits(context);
  on(
    ROUTES.addFeature,
    mutateProject(async (doc, req) => {
      const feature = req.body?.feature as Feature;
      record(feature, "feature");
      knownKeys(feature, feature.type);
      feature.name ||= nextFeatureName(doc, feature.type);
      validateFeature(feature);
      if (doc.features.some((f) => f.id === feature.id))
        throw new ValidationError("duplicate feature id");
      const at = Math.min(doc.timelinePosition, doc.features.length);
      let warning: string | undefined;
      if (
        feature.type === "sketch" &&
        feature.plane.kind === "face" &&
        feature.entities.length === 0
      ) {
        const boundary = await kernel.stateQuery(doc, {
          kind: "projectFace",
          position: at,
          face: feature.plane.face,
        });
        feature.entities = boundary.entities;
        warning = boundary.warning;
        validateBuilt(feature);
      }
      await signed(doc, at, feature);
      doc.features.splice(at, 0, feature);
      doc.timelinePosition = at + 1;
      await written(doc, at, req.res.locals.user);
      return { label: `Add ${feature.name}`, ...(warning && { warning }) };
    }, true),
  );
}

function updateFeatureRoute(context: ApiRoutes) {
  const { on, mutateProject } = context;
  const { pinned, written, signed } = featureEdits(context);
  on(
    ROUTES.updateFeature,
    mutateProject(async (doc, req) => {
      const position = evaluationPosition(req, doc);
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      const current = doc.features[idx];
      if (!current) throw new StoreError("feature not found", "not_found");
      const patch = req.body?.feature as Partial<Feature>;
      record(patch, "feature");
      if (patch.type !== undefined && patch.type !== current.type)
        throw new ValidationError("feature type cannot change");
      knownKeys(patch, current.type);
      const updated = { ...current, ...patch, id: current.id } as Feature;
      if (retargets(patch)) Reflect.deleteProperty(updated, "targets");
      if ("openFaces" in patch && !("body" in patch))
        Reflect.deleteProperty(updated, "body");
      validateFeature(updated);
      await signed(doc, idx, updated, current);
      doc.features[idx] = updated;
      await (keepsTargets(patch)
        ? pinned(doc, idx)
        : written(doc, idx, req.res.locals.user));
      return { label: `Edit ${updated.name}`, position };
    }, true),
  );
}

function projectEdgeRoute(context: ApiRoutes) {
  const { on, wrap, store, kernel } = context;
  on(
    ROUTES.projectEdge,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const index = doc.features.findIndex((f) => f.id === req.params.fid);
      const sketch = doc.features[index];
      if (!sketch || sketch.type !== "sketch")
        throw new ValidationError("Sketch not found");
      const { edge, entityId } = req.body;
      res.json({
        entities: await kernel.stateQuery(doc, {
          kind: "projectEdge",
          position: index,
          plane: sketch.plane,
          edge,
          entityId,
        }),
      });
    }),
  );
}

function timelineRoutes(context: ApiRoutes) {
  const { on, mutateProject, store } = context;
  on(
    ROUTES.deleteFeature,
    mutateProject(async (doc, req) => {
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      if (idx < 0) throw new StoreError("feature not found", "not_found");
      const [deleted] = doc.features.splice(idx, 1);
      doc.parameterBindings = doc.parameterBindings.filter(
        (binding) => binding.featureId !== deleted!.id,
      );
      if (doc.timelinePosition > idx) doc.timelinePosition--;
      await pruneViews(store.documents.options.storage, doc.id, deleted!.id);
      return { label: `Delete ${deleted!.name}` };
    }),
  );

  on(
    ROUTES.setTimeline,
    mutateProject(async (doc, req) => {
      const { position } = req.body;
      if (position > doc.features.length)
        throw new ValidationError("invalid timeline position", "/position");
      doc.timelinePosition = position;
      return { label: "Roll timeline" };
    }),
  );
}

export function featureRoutes(context: ApiRoutes) {
  addFeatureRoute(context);
  updateFeatureRoute(context);
  projectEdgeRoute(context);
  timelineRoutes(context);
}
