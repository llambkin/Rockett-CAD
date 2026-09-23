/**
 * REST API.
 *
 * The server owns the document: clients send feature-level operations, the
 * server validates, persists (autosave on every mutation) and returns the
 * updated document plus a fresh incremental evaluation.
 */

import { Router, json } from "express";
import multer from "multer";
import {
  nextFeatureName,
  newId,
  projectEdge,
  SCHEMA_VERSION,
  type ApiErrorBody,
  type ApiErrorCode,
  type CadDocument,
  type ExportRequest,
  type Feature,
} from "@rockett/shared";
import { version } from "../../../package.json";
import type { ProjectStore } from "../store/projectStore.js";
import { StoreError } from "../store/projectStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import { engineFor, dropEngine } from "../geometry/engine.js";
import { measure } from "../geometry/measure.js";
import { resolvePlaneFrame } from "../geometry/features.js";
import { computeEdgeNames } from "../geometry/naming.js";
import { curveInfo } from "../geometry/tessellate.js";
import { tangentEdges } from "../geometry/tangentEdges.js";
import { readStep } from "../geometry/stepImport.js";
import { write3mf, writeStl } from "../geometry/exporters.js";
import type { NamedBody } from "../geometry/naming.js";
import {
  knownKeys,
  parseEdgeRef,
  record,
  validateDocument,
  validateFeature,
  ValidationError,
} from "./validate.js";

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  not_found: 404,
  too_large: 413,
  conflict: 409,
  kernel: 503,
  internal: 500,
};

function sendError(res: any, body: ApiErrorBody) {
  res.status(STATUS[body.code]).json(body);
}

function multipart(field: string, megabytes: number, error: string) {
  const receive = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: megabytes * 1024 * 1024, files: 1 },
  }).single(field);
  return (req: any, res: any, next: any) =>
    receive(req, res, (err: any) => {
      if (!err) return next();
      sendError(res, {
        error,
        code: err.code === "LIMIT_FILE_SIZE" ? "too_large" : "validation",
      });
    });
}

const receiveImage = multipart(
  "image",
  25,
  "Upload one PNG, JPEG or WebP image, up to 25 MB.",
);
const receiveStep = multipart(
  "file",
  10,
  "Upload one STEP file (.step or .stp), up to 10 MB.",
);

const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const IMAGE_MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  {
    mime: "image/png",
    test: (b) => b.length >= 33 && b.subarray(0, 16).equals(PNG_HEAD),
  },
  {
    mime: "image/jpeg",
    test: (b) =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

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

export function createApiRouter(store: ProjectStore): Router {
  const router = Router();
  router.use(json({ limit: "50mb" }));

  // Serialize the whole load/edit/save/evaluate operation for each project.
  // Locking only save() would still allow two requests to edit stale copies.
  const projects = new ProjectQueue();

  const wrap =
    (fn: (req: any, res: any) => Promise<void>) => (req: any, res: any) => {
      const result = req.params.id
        ? projects.run(req.params.id, () => fn(req, res))
        : fn(req, res);
      result.catch((err) => {
        const code: ApiErrorCode =
          err instanceof StoreError || err instanceof ValidationError
            ? err.code
            : "internal";
        if (code !== "internal")
          return sendError(res, { error: err.message, code });
        console.error(err);
        sendError(res, { error: "Internal server error", code });
      });
    };

  /** Temporary evaluation range; does not move the persisted timeline marker. */
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

  /** Evaluate + make sure every body has display metadata. */
  async function evaluateAndSync(doc: CadDocument, position?: number) {
    const engine = engineFor(doc.id);
    const evaluation = engine.evaluate(doc, position);
    let metaChanged = false;
    for (const body of evaluation.bodies) {
      if (!doc.bodyMeta[body.bodyId]) {
        const n = (doc.counters["body"] ?? 0) + 1;
        doc.counters["body"] = n;
        doc.bodyMeta[body.bodyId] = { name: `Body${n}`, visible: true };
        metaChanged = true;
      }
    }
    if (metaChanged) {
      evaluation.bodies = evaluation.bodies.map((body) => ({
        ...body,
        name: doc.bodyMeta[body.bodyId]!.name,
        visible: doc.bodyMeta[body.bodyId]!.visible,
      }));
      await store.save(doc);
    }
    return evaluation;
  }

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      version,
      schemaVersion: SCHEMA_VERSION,
      commit: process.env.ROCKETT_COMMIT || null,
      describe: process.env.ROCKETT_DESCRIBE || null,
    });
  });

  // ----- projects -----

  router.get(
    "/projects",
    wrap(async (_req, res) => {
      res.json(await store.list());
    }),
  );

  router.post(
    "/projects",
    wrap(async (req, res) => {
      const name = String(req.body?.name ?? "Untitled").slice(0, 200);
      const doc = await store.create(name);
      res.json({ document: doc });
    }),
  );

  router.get(
    "/projects/:id",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json({ document: doc });
    }),
  );

  router.delete(
    "/projects/:id",
    wrap(async (req, res) => {
      await store.remove(req.params.id);
      dropEngine(req.params.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/projects/:id/duplicate",
    wrap(async (req, res) => {
      const copy = await store.duplicate(
        req.params.id,
        req.body?.name ? String(req.body.name).slice(0, 200) : undefined,
      );
      res.json({ document: copy });
    }),
  );

  router.post(
    "/projects/:id/rename",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      doc.name = String(req.body?.name ?? doc.name).slice(0, 200);
      await store.save(doc);
      res.json({ document: doc });
    }),
  );

  // ----- evaluation -----

  router.get(
    "/projects/:id/evaluate",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json(engineFor(doc.id).evaluate(doc, evaluationPosition(req, doc)));
    }),
  );

  // ----- document-level replace (undo/redo restore) -----

  router.put(
    "/projects/:id/document",
    wrap(async (req, res) => {
      const incoming = req.body?.document as CadDocument;
      if (!incoming || incoming.id !== req.params.id) {
        throw new ValidationError("document id mismatch");
      }
      validateDocument(incoming);
      const position = evaluationPosition(req, incoming);
      // Replacement is an edit, not creation (e.g. a delayed undo after delete).
      await store.load(req.params.id);
      await store.save(incoming);
      const evaluation = await evaluateAndSync(incoming, position);
      res.json({ document: incoming, evaluation });
    }),
  );

  // ----- features -----
  const importStep = wrap(async (req, res) => {
    if (!req.file || !/\.(step|stp)$/i.test(req.file.originalname))
      throw new ValidationError("Choose a .step or .stp file");
    const filename = req.file.originalname
      .replace(/^.*[\\/]/, "")
      .slice(0, 255);
    const feature: Feature = {
      id: newId("import"),
      type: "importStep",
      name: filename.slice(0, 120),
      suppressed: false,
      filename,
      data: req.file.buffer.toString("utf8").replace(/^\uFEFF/, ""),
    };
    validateFeature(feature);
    // Reject bad geometry before creating a project or changing its history.
    try {
      readStep(feature.data).delete();
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
    const created = !req.params.id;
    const doc = created
      ? await store.create(filename.replace(/\.(step|stp)$/i, ""))
      : await store.load(req.params.id);
    try {
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, feature);
      doc.timelinePosition = at + 1;
      if (Buffer.byteLength(JSON.stringify(doc), "utf8") > 40 * 1024 * 1024)
        throw new ValidationError(
          "This import would exceed the 40 MB project limit. Start a separate project for this STEP file.",
        );
      const evaluation = engineFor(doc.id).evaluate(doc);
      const status = evaluation.featureStatuses.find(
        (s) => s.featureId === feature.id,
      );
      if (status?.status !== "ok")
        throw new ValidationError(status?.error ?? "STEP import failed");
      await store.save(doc);
      res.json({ document: doc, evaluation: await evaluateAndSync(doc) });
    } catch (error) {
      dropEngine(doc.id);
      if (created) await store.remove(doc.id);
      throw error;
    }
  });
  router.post("/projects/import-step", receiveStep, importStep);
  router.post("/projects/:id/import-step", receiveStep, importStep);

  router.post(
    "/projects/:id/features",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
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
      // Insert at the timeline marker (supports inserting mid-history).
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, feature);
      doc.timelinePosition = at + 1;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      res.json({ document: doc, evaluation });
    }),
  );

  router.put(
    "/projects/:id/features/:fid",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
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
      doc.features[idx] = updated as Feature;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc, position);
      res.json({ document: doc, evaluation });
    }),
  );

  // Resolve against geometry BEFORE the sketch, so projections cannot depend
  // on their own extrude or another downstream feature. This is read-only.
  router.post(
    "/projects/:id/features/:fid/project",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const index = doc.features.findIndex((f) => f.id === req.params.fid);
      const sketch = doc.features[index];
      if (!sketch || sketch.type !== "sketch")
        throw new ValidationError("Sketch not found");
      const { edge: value, entityId } = req.body ?? {};
      const message = "An edge reference and entity ID are required";
      const ref = parseEdgeRef(value, message);
      if (typeof entityId !== "string" || !entityId || entityId.length > 100)
        throw new ValidationError(message);
      const state = engineFor(doc.id).stateAt(doc, index);
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

  router.delete(
    "/projects/:id/features/:fid",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      if (idx < 0) throw new StoreError("feature not found", "not_found");
      doc.features.splice(idx, 1);
      if (doc.timelinePosition > idx) doc.timelinePosition--;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      res.json({ document: doc, evaluation });
    }),
  );

  router.post(
    "/projects/:id/timeline",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const position = Number(req.body?.position);
      if (
        !Number.isInteger(position) ||
        position < 0 ||
        position > doc.features.length
      ) {
        throw new ValidationError("invalid timeline position");
      }
      doc.timelinePosition = position;
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      res.json({ document: doc, evaluation });
    }),
  );

  // ----- bodies -----
  router.post(
    "/projects/:id/tangent-edges",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const { edge: value, beforeFeatureId } = req.body ?? {};
      const edge = parseEdgeRef(value, "An edge reference is required");
      const index =
        beforeFeatureId === undefined
          ? undefined
          : doc.features.findIndex((f) => f.id === beforeFeatureId);
      if (index === -1) throw new ValidationError("Feature not found");
      const state = engineFor(doc.id).stateAt(doc, index);
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

  router.put(
    "/projects/:id/bodies/:bodyId",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const meta = doc.bodyMeta[req.params.bodyId];
      if (!meta) throw new StoreError("body not found", "not_found");
      if (typeof req.body?.name === "string") {
        meta.name = req.body.name.slice(0, 120);
      }
      if (typeof req.body?.visible === "boolean") {
        meta.visible = req.body.visible;
      }
      await store.save(doc);
      const evaluation = await evaluateAndSync(doc);
      res.json({ document: doc, evaluation });
    }),
  );

  // ----- measure -----

  router.post(
    "/projects/:id/measure",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const refs = req.body?.refs;
      if (!Array.isArray(refs) || refs.length === 0 || refs.length > 2) {
        throw new ValidationError("measure requires 1-2 refs");
      }
      const engine = engineFor(doc.id);
      const state = engine.stateAt(doc);
      res.json(measure(state, { refs }));
    }),
  );

  // ----- export -----

  router.post(
    "/projects/:id/export",
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const body = req.body ?? {};
      record(body, "export request");
      const { format = "stl", bodyIds, quality = 0.05 } = body;
      if (typeof format !== "string" || !Object.hasOwn(EXPORTERS, format)) {
        throw new ValidationError(
          `unsupported export format; supported: ${Object.keys(EXPORTERS).join(", ")}`,
        );
      }
      const exporter = EXPORTERS[format as ExportRequest["format"]];
      if (typeof quality !== "number" || !Number.isFinite(quality))
        throw new ValidationError("export quality must be a finite number");
      if (!Array.isArray(bodyIds))
        throw new ValidationError("export bodyIds must be an array");
      const nonStrings = bodyIds.filter((id) => typeof id !== "string");
      if (nonStrings.length)
        throw new ValidationError(
          `export bodyIds must be strings: ${nonStrings.map(String).join(", ")}`,
        );
      const requestedIds: string[] = bodyIds;
      const engine = engineFor(doc.id);
      const state = engine.stateAt(doc);
      const missing = requestedIds.filter((id) => !state.bodies.has(id));
      if (missing.length)
        throw new ValidationError(
          `export bodies not in the model: ${missing.join(", ")}`,
        );
      const chosen = [...state.bodies.values()].filter((b) => {
        if (requestedIds.length > 0) return requestedIds.includes(b.bodyId);
        return doc.bodyMeta[b.bodyId]?.visible !== false;
      });
      if (chosen.length === 0) {
        throw new ValidationError("no bodies to export");
      }
      const safeName =
        doc.name.replace(/[^\w-]+/g, "_").slice(0, 60) || "model";
      const data = exporter.write(
        chosen,
        doc,
        Math.min(Math.max(quality, 0.001), 1),
      );
      const fileName = `${safeName}.${format}`;
      res.setHeader("Content-Type", exporter.mime);
      if (body.retain) {
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

  router.post(
    "/projects/:id/assets",
    receiveImage,
    wrap(async (req, res) => {
      await store.load(req.params.id); // ensure project exists
      const file = req.file;
      if (!file) throw new ValidationError("image file required");
      const magic = IMAGE_MAGIC.find((m) => m.test(file.buffer));
      if (!magic) {
        throw new ValidationError(
          "unsupported image type (PNG, JPEG, WebP only)",
        );
      }
      const { assetId } = await store.saveAsset(
        req.params.id,
        file.buffer,
        magic.mime,
      );
      res.json({ assetId });
    }),
  );

  router.get(
    "/projects/:id/assets/:assetId",
    wrap(async (req, res) => {
      const p = await store.assetPath(req.params.id, req.params.assetId);
      res.sendFile(p);
    }),
  );

  return router;
}
