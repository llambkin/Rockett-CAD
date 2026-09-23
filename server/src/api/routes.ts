/**
 * REST API.
 *
 * The server owns the document: clients send feature-level operations, the
 * server validates, persists (autosave on every mutation) and returns the
 * updated document plus a fresh incremental evaluation.
 */

import { Router, json, type RequestHandler } from "express";
import {
  DOCUMENT_EDITS,
  nextFeatureName,
  parse,
  projectEdge,
  ROUTES,
  SCHEMA_VERSION,
  ValidationError,
  type ApiErrorBody,
  type ApiErrorCode,
  type CadDocument,
  type EvaluateResult,
  type ExportRequest,
  type Feature,
  type Method,
  type ProjectView,
  type Route,
} from "@rockett/shared";
import { build } from "../build.js";
import { emptyView, type ProjectStore } from "../store/projectStore.js";
import { splitView } from "../store/migrations.js";
import type { FolderStore } from "../store/folderStore.js";
import { StoreError } from "../store/projectStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import { engineFor, dropEngine } from "../geometry/engine.js";
import { measure } from "../geometry/measure.js";
import { resolvePlaneFrame } from "../geometry/features.js";
import { computeEdgeNames } from "../geometry/naming.js";
import { curveInfo } from "../geometry/tessellate.js";
import { tangentEdges } from "../geometry/tangentEdges.js";
import { importerFor, IMPORTERS } from "../geometry/importers.js";
import { write3mf, writeStl } from "../geometry/exporters.js";
import type { NamedBody } from "../geometry/naming.js";
import {
  knownKeys,
  record,
  validateDocument,
  validateFeature,
} from "./validate.js";
import {
  downloadProjectFile,
  safeFileName,
  uploadProjectFile,
} from "./projectFile.js";
import { folderRoutes } from "./folderRoutes.js";
import {
  discarding,
  IMPORT_LIMITS,
  readUpload,
  receiveImage,
  receiveImport,
  receiveProjectFile,
  type ImportLimits,
  type Upload,
} from "./uploads.js";
import {
  checkRevision,
  ifMatchRevision,
  reply,
  RevisionConflict,
} from "./revision.js";
import { omitHeldMeshes } from "./heldMeshes.js";
import {
  takeVisible,
  withVisible,
  withVisibleBodies,
} from "./legacyVisible.js";

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  not_found: 404,
  too_large: 413,
  conflict: 409,
  precondition_required: 428,
  unprocessable: 422,
  kernel: 503,
  internal: 500,
};

function sendError(res: any, body: ApiErrorBody) {
  res.status(STATUS[body.code]).json(body);
}

function fail(res: any, err: any) {
  const code: ApiErrorCode =
    err instanceof StoreError || err instanceof ValidationError
      ? err.code
      : "internal";
  if (code !== "internal")
    return sendError(res, {
      error: err.message,
      code,
      ...(err.detail !== undefined && { detail: err.detail }),
      ...(err instanceof RevisionConflict && { revision: err.revision }),
    });
  console.error(err);
  sendError(res, { error: "Internal server error", code });
}

function check(test: (req: any, res: any) => void): RequestHandler {
  return (req, res, next) => {
    try {
      test(req, res);
    } catch (err) {
      return fail(res, err);
    }
    next();
  };
}

const parseBody = (schema: NonNullable<Route["body"]>) =>
  check((req) => (req.body = parse(schema, req.body ?? {})));

const requireRevision = check((req, res) => {
  res.locals.revision = ifMatchRevision(req.get("If-Match"));
});

const EXPORTERS: Record<
  ExportRequest["format"],
  {
    mime: string;
    write: (bodies: NamedBody[], doc: CadDocument, quality: number) => Buffer;
  }
> = {
  stl: {
    mime: "model/stl",
    write: (bodies, _doc, quality) => writeStl(bodies, quality),
  },
  "3mf": {
    mime: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
    write: (bodies, doc, quality) =>
      write3mf(
        bodies.map((b) => ({
          body: b,
          name: doc.bodyMeta[b.bodyId]?.name ?? b.bodyId,
        })),
        quality,
      ),
  },
};

function evaluationPosition(req: any, doc: CadDocument): number | undefined {
  if (req.query.position === undefined) return undefined;
  const position = Number(req.query.position);
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > doc.features.length
  )
    throw new ValidationError("invalid evaluation position");
  return position;
}

function pruneGroups(
  doc: CadDocument,
  evaluation: EvaluateResult,
  position: number | undefined,
): boolean {
  const sketches = new Set(
    doc.features.filter((f) => f.type === "sketch").map((f) => f.id),
  );
  const bodies =
    position === undefined && doc.timelinePosition === doc.features.length
      ? new Set(evaluation.bodies.map((b) => b.bodyId))
      : null;
  let changed = false;
  for (const group of doc.groups) {
    const kept = group.members.filter((id) =>
      group.kind === "sketch" ? sketches.has(id) : (bodies?.has(id) ?? true),
    );
    changed ||= kept.length !== group.members.length;
    group.members = kept;
  }
  return changed;
}

export function createApiRouter(
  store: ProjectStore,
  folders: FolderStore,
  projects = new ProjectQueue(),
  limits: Partial<ImportLimits> = {},
): Router {
  const { uploadBytes, importBytes } = { ...IMPORT_LIMITS, ...limits };
  const router = Router();
  router.use(json({ limit: "50mb" }), check(omitHeldMeshes));
  const on = (route: Route, ...handlers: RequestHandler[]) =>
    router[route.method.toLowerCase() as Lowercase<Method>](
      route.path,
      ...(route.body ? [parseBody(route.body)] : []),
      ...(DOCUMENT_EDITS.has(route) ? [requireRevision] : []),
      ...handlers,
    );

  // Serialize the whole load/edit/save/evaluate operation for each project.
  // Locking only save() would still allow two requests to edit stale copies.
  const wrap =
    (fn: (req: any, res: any) => Promise<void>) => (req: any, res: any) => {
      const { id } = req.params;
      const result = id
        ? projects.run(id, () => store.touch(id).then(() => fn(req, res)))
        : fn(req, res);
      result.catch((err) => fail(res, err));
    };

  const editable = async (req: any, res: any) => {
    const opened = await store.open(req.params.id);
    checkRevision(opened.doc, res.locals.revision);
    return opened;
  };

  const send = (
    res: any,
    view: ProjectView,
    doc: CadDocument,
    evaluation?: EvaluateResult,
  ) =>
    reply(res, {
      document: withVisible(doc, view),
      ...(evaluation && { evaluation: withVisibleBodies(evaluation, view) }),
    });

  async function evaluate(doc: CadDocument, position?: number) {
    return engineFor(doc.id).evaluate(doc, position, await store.sources(doc));
  }

  async function stateAt(doc: CadDocument, position?: number) {
    return engineFor(doc.id).stateAt(doc, position, await store.sources(doc));
  }

  /** Evaluate + make sure every body has display metadata. */
  async function evaluateAndSync(doc: CadDocument, position?: number) {
    const evaluation = await evaluate(doc, position);
    let metaChanged = pruneGroups(doc, evaluation, position);
    for (const body of evaluation.bodies) {
      if (!doc.bodyMeta[body.bodyId]) {
        const n = (doc.counters["body"] ?? 0) + 1;
        doc.counters["body"] = n;
        doc.bodyMeta[body.bodyId] = { name: `Body${n}` };
        metaChanged = true;
      }
    }
    if (metaChanged) {
      evaluation.bodies = evaluation.bodies.map((body) => ({
        ...body,
        name: doc.bodyMeta[body.bodyId]!.name,
      }));
      await store.save(doc);
    }
    return evaluation;
  }

  on(ROUTES.health, (_req, res) => {
    res.json({
      ok: true,
      ...build(),
      schemaVersion: SCHEMA_VERSION,
      describe: process.env.ROCKETT_DESCRIBE || null,
    });
  });

  // ----- projects -----

  on(
    ROUTES.listProjects,
    wrap(async (_req, res) => {
      res.json(await store.list());
    }),
  );

  on(
    ROUTES.createProject,
    wrap(async (req, res) => {
      const name = (req.body.name ?? "Untitled").slice(0, 200);
      const { folderId } = req.body;
      const doc =
        folderId === undefined
          ? await store.create(name)
          : await folders.createIn(folderId, () => store.create(name));
      res.json({ document: doc });
    }),
  );

  on(ROUTES.downloadProjectFile, wrap(downloadProjectFile(store)));
  on(
    ROUTES.uploadProjectFile,
    receiveProjectFile,
    wrap(uploadProjectFile(store, folders)),
  );

  on(
    ROUTES.getProject,
    wrap(async (req, res) => {
      const { doc, view } = await store.open(req.params.id);
      send(res, view, doc);
    }),
  );

  on(
    ROUTES.deleteProject,
    wrap(async (req, res) => {
      await store.remove(req.params.id);
      dropEngine(req.params.id);
      await folders.place(req.params.id, null);
      res.json({ ok: true });
    }),
  );

  on(
    ROUTES.duplicateProject,
    wrap(async (req, res) => {
      const copy = await store.duplicate(
        req.params.id,
        req.body.name ? req.body.name.slice(0, 200) : undefined,
      );
      res.json({ document: copy });
    }),
  );

  on(
    ROUTES.renameProject,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      doc.name = (req.body.name ?? doc.name).slice(0, 200);
      await store.save(doc);
      send(res, view, doc);
    }),
  );

  for (const [route, handler] of folderRoutes(folders, store))
    on(route, wrap(handler));

  // ----- evaluation -----

  on(
    ROUTES.evaluate,
    wrap(async (req, res) => {
      const { doc, view } = await store.open(req.params.id);
      res.json(
        withVisibleBodies(
          await evaluate(doc, evaluationPosition(req, doc)),
          view,
        ),
      );
    }),
  );

  // ----- document-level replace (undo/redo restore) -----

  on(
    ROUTES.replaceDocument,
    wrap(async (req, res) => {
      const sent = req.body?.document;
      if (!sent || sent.id !== req.params.id) {
        throw new ValidationError("document id mismatch");
      }
      validateDocument(sent);
      const { doc, shown } = splitView(sent);
      const incoming = doc as unknown as CadDocument;
      const position = evaluationPosition(req, incoming);
      // Replacement is an edit, not creation (e.g. a delayed undo after delete).
      const { view } = await editable(req, res);
      await store.save(incoming);
      const next = await store.setVisible(incoming.id, view, shown);
      const evaluation = await evaluateAndSync(incoming, position);
      send(res, next, incoming, evaluation);
    }),
  );

  // ----- features -----
  const receiveStep = receiveImport(store.uploads, uploadBytes);
  const importUpload = async (req: any, res: any) => {
    const file: Upload | undefined = req.file,
      importer = file && importerFor(file.originalname);
    if (!file || !importer)
      throw new ValidationError(
        `Choose a ${IMPORTERS.flatMap((i) => i.extensions).join(", ")} file`,
      );
    const filename = file.originalname.replace(/^.*[\\/]/, "").slice(0, 255);
    const { features, sources } = importer.read(
      await readUpload(store.uploads, file, importBytes),
      filename,
    );
    features.forEach(validateFeature);
    const created = !req.params.id;
    const { doc, view } = created
      ? {
          doc: await store.create(filename.replace(/\.[^.]*$/, "")),
          view: emptyView(),
        }
      : await editable(req, res);
    try {
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, ...features);
      doc.timelinePosition = at + features.length;
      if (Buffer.byteLength(JSON.stringify(doc), "utf8") > 40 * 1024 * 1024)
        throw new ValidationError(
          `This import would exceed the 40 MB project limit. Start a separate project for this ${importer.label} file.`,
        );
      const evaluation = engineFor(doc.id).evaluate(
        doc,
        undefined,
        new Map([...(await store.sources(doc)), ...sources]),
      );
      for (const feature of features) {
        const status = evaluation.featureStatuses.find(
          (s) => s.featureId === feature.id,
        );
        if (status?.status !== "ok" && status?.status !== "warning")
          throw new ValidationError(
            status?.error ?? `${importer.label} import failed`,
          );
      }
      for (const [hash, bytes] of sources)
        await (hash === file.hash
          ? store.blobs(doc.id).adopt(file)
          : store.blobs(doc.id).put(bytes));
      await store.save(doc);
      send(res, view, doc, await evaluateAndSync(doc));
    } catch (error) {
      dropEngine(doc.id);
      if (created) await store.remove(doc.id);
      throw error;
    }
  };
  const importStep = wrap(discarding(store.uploads, importUpload));
  on(ROUTES.importStep, receiveStep, importStep);
  on(ROUTES.importStepInto, receiveStep, importStep);

  on(
    ROUTES.addFeature,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      const feature = req.body?.feature as Feature;
      record(feature, "feature");
      knownKeys(feature, feature.type);
      if (!feature.name) {
        feature.name = nextFeatureName(doc, feature.type);
      }
      validateFeature(feature);
      if (doc.features.some((f) => f.id === feature.id)) {
        throw new ValidationError("duplicate feature id");
      }
      const shown = takeVisible(feature, feature.id);
      // Insert at the timeline marker (supports inserting mid-history).
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, feature);
      doc.timelinePosition = at + 1;
      await store.save(doc);
      const next = await store.setVisible(doc.id, view, shown);
      const evaluation = await evaluateAndSync(doc);
      send(res, next, doc, evaluation);
    }),
  );

  on(
    ROUTES.updateFeature,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      const position = evaluationPosition(req, doc);
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      if (idx < 0) throw new StoreError("feature not found", "not_found");
      const patch = req.body?.feature as Partial<Feature>;
      record(patch, "feature");
      if (patch.type !== undefined && patch.type !== doc.features[idx]!.type) {
        throw new ValidationError("feature type cannot change");
      }
      knownKeys(patch, doc.features[idx]!.type);
      const updated = {
        ...doc.features[idx],
        ...patch,
        id: doc.features[idx]!.id,
      };
      validateFeature(updated as Feature);
      const next = await store.setVisible(
        doc.id,
        view,
        takeVisible(updated as Feature, updated.id),
      );
      doc.features[idx] = updated as Feature;
      if (Object.keys(patch).some((key) => key !== "visible"))
        await store.save(doc);
      const evaluation = await evaluateAndSync(doc, position);
      send(res, next, doc, evaluation);
    }),
  );

  // Resolve against geometry BEFORE the sketch, so projections cannot depend
  // on their own extrude or another downstream feature. This is read-only.
  on(
    ROUTES.projectEdge,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const index = doc.features.findIndex((f) => f.id === req.params.fid);
      const sketch = doc.features[index];
      if (!sketch || sketch.type !== "sketch")
        throw new ValidationError("Sketch not found");
      const { edge: ref, entityId } = req.body;
      const state = await stateAt(doc, index);
      const body = state.bodies.get(ref.bodyId);
      const edge = body && computeEdgeNames(body).byName.get(ref.edgeName);
      if (!edge)
        throw new ValidationError(
          "This edge is not available before the sketch. Choose geometry from an earlier feature.",
        );
      try {
        res.json({
          entities: projectEdge(
            curveInfo(edge),
            resolvePlaneFrame(state, sketch.plane),
            entityId,
            ref,
          ),
        });
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
    }),
  );

  on(
    ROUTES.deleteFeature,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      if (idx < 0) throw new StoreError("feature not found", "not_found");
      doc.features.splice(idx, 1);
      if (doc.timelinePosition > idx) doc.timelinePosition--;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      send(res, view, doc, evaluation);
    }),
  );

  on(
    ROUTES.setTimeline,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      const { position } = req.body;
      if (position > doc.features.length)
        throw new ValidationError("invalid timeline position", "/position");
      doc.timelinePosition = position;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      send(res, view, doc, evaluation);
    }),
  );

  // ----- bodies -----
  on(
    ROUTES.tangentEdges,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const { edge, beforeFeatureId } = req.body;
      const index =
        beforeFeatureId === undefined
          ? undefined
          : doc.features.findIndex((f) => f.id === beforeFeatureId);
      if (index === -1) throw new ValidationError("Feature not found");
      const state = await stateAt(doc, index);
      const body = state.bodies.get(edge.bodyId);
      if (!body)
        throw new ValidationError("Body not found before this feature");
      try {
        res.json({ edges: tangentEdges(body, [edge]) });
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
    }),
  );

  on(
    ROUTES.updateGroups,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      doc.groups = req.body.groups;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      send(res, view, doc, evaluation);
    }),
  );

  on(
    ROUTES.updateBody,
    wrap(async (req, res) => {
      const { doc, view } = await editable(req, res);
      const { bodyId } = req.params;
      const meta = doc.bodyMeta[bodyId];
      if (!meta) throw new StoreError("body not found", "not_found");
      const { name, visible } = req.body;
      const next = await store.setVisible(doc.id, view, {
        bodies: visible === undefined ? {} : { [bodyId]: visible },
        features: {},
      });
      if (name !== undefined) {
        meta.name = name.slice(0, 120);
        await store.save(doc);
      }
      const evaluation = await evaluateAndSync(doc);
      send(res, next, doc, evaluation);
    }),
  );

  on(
    ROUTES.getView,
    wrap(async (req, res) => {
      res.json(await store.view(req.params.id));
    }),
  );

  on(
    ROUTES.putView,
    wrap(async (req, res) => {
      await store.setView(req.params.id, req.body);
      res.json(req.body);
    }),
  );

  // ----- measure -----

  on(
    ROUTES.measure,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const state = await stateAt(doc);
      res.json(measure(state, req.body));
    }),
  );

  // ----- export -----

  on(
    ROUTES.exportModel,
    wrap(async (req, res) => {
      const { doc, view } = await store.open(req.params.id);
      const {
        format,
        bodyIds: requestedIds,
        quality = 0.05,
        retain,
      }: ExportRequest = req.body;
      const exporter = EXPORTERS[format];
      const state = await stateAt(doc);
      const missing = requestedIds.filter((id) => !state.bodies.has(id));
      if (missing.length)
        throw new ValidationError(
          `export bodies not in the model: ${missing.join(", ")}`,
        );
      const chosen = [...state.bodies.values()].filter((b) => {
        if (requestedIds.length > 0) return requestedIds.includes(b.bodyId);
        return !view.hidden.bodies.includes(b.bodyId);
      });
      if (chosen.length === 0) {
        throw new ValidationError("no bodies to export");
      }
      const safeName = safeFileName(doc.name) || "model";
      const data = exporter.write(
        chosen,
        doc,
        Math.min(Math.max(quality, 0.001), 1),
      );
      const fileName = `${safeName}.${format}`;
      res.setHeader("Content-Type", exporter.mime);
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

  // ----- assets (reference images) -----

  on(
    ROUTES.uploadImage,
    receiveImage,
    wrap(async (req, res) => {
      await store.load(req.params.id); // ensure project exists
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

  return router;
}
