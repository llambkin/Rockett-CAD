import {
  nextFeatureName,
  ROUTES,
  SIZE_KEYS,
  ValidationError,
  type ExportRequest,
  type SizedFeature,
} from "@rockett/shared";
import { meshRoute } from "./meshRoute.js";
import { knownKeys, record, validateFeature } from "./validate.js";
import { safeFileName } from "./projectFile.js";
import { receiveImage } from "./uploads.js";
import type { ApiRoutes } from "./projectMutations.js";
import { evaluationPosition } from "./evaluationPosition.js";

export function evaluationRoutes(context: ApiRoutes) {
  const { on, wrap, store, evaluate, meshCache } = context;
  on(ROUTES.mesh, wrap(meshRoute(store, meshCache, evaluate)));

  on(
    ROUTES.evaluate,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const position = evaluationPosition(req, doc);
      const result = await evaluate(doc, position);
      res.json(
        meshCache.publish(
          doc.id,
          doc.revision,
          result,
          position === undefined || position === doc.timelinePosition,
        ),
      );
    }),
  );
}

export function tangentEdgesRoute(context: ApiRoutes) {
  const { on, wrap, store, kernel } = context;
  on(
    ROUTES.tangentEdges,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const { edge, beforeFeatureId } = req.body;
      const index = doc.features.findIndex((f) => f.id === beforeFeatureId);
      res.json({
        edges: await kernel.stateQuery(doc, {
          kind: "tangentEdges",
          position: index === -1 ? undefined : index,
          edge,
        }),
      });
    }),
  );
}

export function sizeLimitRoute(context: ApiRoutes) {
  const { on, wrap, store, kernel } = context;
  on(
    ROUTES.sizeLimit,
    wrap(async (req, res) => {
      const feature = req.body?.feature as SizedFeature;
      record(feature, "feature");
      if (
        typeof feature.type !== "string" ||
        !Object.hasOwn(SIZE_KEYS, feature.type) ||
        (feature.type === "extrude" && feature.operation !== "cut") ||
        (feature.type === "offsetFace" && feature.distance >= 0)
      )
        throw new ValidationError(
          "size limits cover fillet, chamfer, shell, cut extrude, linear pattern and inward offset face",
        );
      const doc = await store.load(req.params.id);
      knownKeys(feature, feature.type);
      feature.name ||= nextFeatureName(doc, feature.type);
      validateFeature(feature);
      res.json(
        await kernel.stateQuery(doc, {
          kind: "sizeLimit",
          position: evaluationPosition(req, doc),
          feature,
        }),
      );
    }),
  );
}

export function exportAssetRoutes(context: ApiRoutes) {
  const { on, wrap, store, kernel } = context;
  on(
    ROUTES.exportModel,
    wrap(async (req, res, ctx) => {
      if (req.body.retain && res.locals.projectRole === "view")
        return res.status(403).json({ error: "forbidden" });
      const doc = await store.load(req.params.id);
      const view = await store.view(doc.id, ctx.user.id);
      const { retain, ...request }: ExportRequest = req.body;
      const { data, mime, ext } = await kernel.export(doc, {
        ...request,
        hidden: view.hidden.bodies,
      });
      const fileName = `${safeFileName(doc.name) || "model"}.${ext}`;
      res.setHeader("Content-Type", mime);
      if (retain) {
        await store.saveExport(doc.id, fileName, data);
      }
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.send(data);
    }),
  );

  on(
    ROUTES.uploadImage,
    receiveImage,
    wrap(async (req, res) => {
      await store.load(req.params.id);
      if (!req.file) throw new ValidationError("image file required");
      const { assetId } = await store.saveAsset(req.params.id, req.file.buffer);
      res.json({ assetId });
    }),
  );

  on(
    ROUTES.asset,
    wrap(async (req, res) => {
      const asset = await store.readAsset(req.params.id, req.params.assetId);
      res.type(asset.mime).send(asset.data);
    }),
  );
}
