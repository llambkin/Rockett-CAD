import {
  MAX_IMPORT_BYTES,
  projectEdge,
  ValidationError,
  type CadDocument,
  type EdgeRef,
  type EvaluateResult,
  type ExportRequest,
  type ExportSource,
  type FaceRef,
  type Feature,
  type Formats,
  type Health,
  type MeasureRequest,
  type MeasureResult,
  type NamingDecision,
  type NamingMapping,
  type PlaneRef,
  type RefSignature,
  type SizeLimit,
  type SizedFeature,
  type SketchEntity,
} from "@rockett/shared";
import { StoreError, type ProjectStore } from "../store/projectStore.js";
import {
  dropEngine,
  engineFor,
  type EvaluateHooks,
} from "../geometry/engine.js";
import { kernelVersion, release } from "../geometry/kernel.js";
import { measure } from "../geometry/measure.js";
import { resolvePlaneFrame, type EvalState } from "../geometry/features.js";
import { computeEdgeNames } from "../geometry/naming.js";
import { curveInfo } from "../geometry/tessellate.js";
import { faceDrawing } from "../geometry/dxf.js";
import { signRefs } from "../geometry/signature.js";
import { planNamingUpgrade } from "../geometry/upgradeNaming.js";
import { tangentEdges } from "../geometry/tangentEdges.js";
import { sizeLimit } from "../geometry/sizeLimit.js";
import { IMPORTERS, type Sources } from "../geometry/importers.js";
import {
  importers,
  importFile,
  registerImporter,
  type ImportUpload,
} from "../api/importers.js";
import {
  EXPORT_QUALITY,
  exporterFor,
  exporters,
  type ExportContext,
} from "../geometry/exporters.js";

interface StateQueries {
  measure: { request: MeasureRequest };
  tangentEdges: { position: number | undefined; edge: EdgeRef };
  projectEdge: {
    position: number;
    plane: PlaneRef;
    edge: EdgeRef;
    entityId: string;
  };
  projectFace: { position: number; face: FaceRef };
  sign: { position: number; refs: Array<FaceRef | EdgeRef> };
  sizeLimit: { position: number | undefined; feature: SizedFeature };
}

export type StateQuery<K extends keyof StateQueries = keyof StateQueries> = {
  [P in K]: { kind: P } & StateQueries[P];
}[K];

export interface StateAnswers {
  measure: MeasureResult;
  tangentEdges: EdgeRef[];
  projectEdge: SketchEntity[];
  projectFace: SketchEntity[];
  sign: Array<RefSignature | undefined>;
  sizeLimit: SizeLimit;
}

export interface ExportJob extends Omit<ExportRequest, "retain"> {
  hidden: readonly string[];
}

export interface Imported {
  label: string;
  filename: string;
  features: Feature[];
  sources: Sources;
}

for (const importer of IMPORTERS)
  registerImporter({ ...importer, bytes: MAX_IMPORT_BYTES });

export interface NamingPlan {
  document: CadDocument;
  mappings: NamingMapping[];
}

export interface KernelClient {
  evaluate(
    doc: CadDocument,
    position?: number,
    extra?: Sources,
    hooks?: EvaluateHooks,
  ): Promise<EvaluateResult>;
  stateQuery<K extends keyof StateQueries>(
    doc: CadDocument,
    query: StateQuery<K>,
  ): Promise<StateAnswers[K]>;
  visibleTargets(
    doc: CadDocument,
    index: number,
    hidden: readonly string[],
  ): Promise<string[] | undefined>;
  export(
    doc: CadDocument,
    job: ExportJob,
  ): Promise<{ data: Buffer; mime: string; ext: string }>;
  formats(): Promise<Formats>;
  importStep(upload: ImportUpload | undefined): Promise<Imported>;
  planNamingUpgrade(
    doc: CadDocument,
    accept?: NamingDecision[],
  ): Promise<NamingPlan>;
  drop(docId: string): void;
  version(): Health["kernelVersion"];
  status(): Health["kernel"];
}

function asValidation<T>(run: () => T, detail?: string): T {
  try {
    return run();
  } catch (error) {
    throw new ValidationError((error as Error).message, detail);
  }
}

const ANSWERS: {
  [K in keyof StateQueries]: (
    state: EvalState,
    query: StateQuery<K>,
    doc: CadDocument,
    resume?: () => Promise<EvalState>,
  ) => StateAnswers[K] | Promise<StateAnswers[K]>;
} = {
  measure: (state, { request }) => measure(state, request),
  tangentEdges(state, { edge }) {
    const body = state.bodies.get(edge.bodyId);
    if (!body) throw new ValidationError("Body not found before this feature");
    return asValidation(() => tangentEdges(body, [edge]));
  },
  projectEdge(state, { plane, edge: ref, entityId }) {
    const body = state.bodies.get(ref.bodyId);
    const byName = body && computeEdgeNames(body).byName;
    try {
      const edge = byName?.get(ref.edgeName);
      if (!edge)
        throw new ValidationError(
          "This edge is not available before the sketch. Choose geometry from an earlier feature.",
        );
      return asValidation(() =>
        projectEdge(
          curveInfo(edge),
          resolvePlaneFrame(state, plane),
          entityId,
          ref,
        ),
      );
    } finally {
      release(byName?.values() ?? []);
    }
  },
  projectFace(state, { face: ref }) {
    const body = state.bodies.get(ref.bodyId);
    if (!body)
      throw new ValidationError(
        "Face body is not available before this sketch",
      );
    return asValidation(() => {
      const frame = resolvePlaneFrame(state, { kind: "face", face: ref });
      const drawing = faceDrawing(body, ref.faceName, frame, 0.1);
      if (drawing.polylines.length > 0)
        throw new Error(
          "This face has unsupported boundary curves. Choose a construction plane or a face with straight or circular edges.",
        );
      return drawing.sketch;
    });
  },
  sign(state, { refs }) {
    const signed = structuredClone(refs);
    signRefs(state.bodies, signed);
    return signed.map((ref) => ref.sig);
  },
  sizeLimit: (state, { position, feature }, doc, resume) =>
    sizeLimit(state, doc, position, feature, resume),
};

function exportBodies(state: EvalState, { bodyIds, hidden }: ExportJob) {
  const blocked = [...state.blocked].filter((id) =>
    bodyIds.length > 0 ? bodyIds.includes(id) : !hidden.includes(id),
  );
  if (blocked.length)
    throw new StoreError(
      `export bodies depend on unresolved references: ${blocked.join(", ")}`,
      "unprocessable",
    );
  const missing = bodyIds.filter((id) => !state.bodies.has(id));
  if (missing.length)
    throw new ValidationError(
      `export bodies not in the model: ${missing.join(", ")}`,
    );
  const chosen = [...state.bodies.values()].filter((b) =>
    bodyIds.length > 0
      ? bodyIds.includes(b.bodyId)
      : !hidden.includes(b.bodyId),
  );
  if (chosen.length === 0) throw new ValidationError("no bodies to export");
  return { bodies: chosen, sketch: [], polylines: [] };
}

function exportSketch(state: EvalState, { format, sketchId }: ExportJob) {
  if (!sketchId)
    throw new ValidationError(`${format} export needs a sketchId`, "/sketchId");
  const sketch = state.sketches.get(sketchId);
  if (!sketch)
    throw new ValidationError(
      `sketch ${sketchId} is not in the model`,
      "/sketchId",
    );
  return { bodies: [], sketch: sketch.entities, polylines: [] };
}

function exportFace(
  state: EvalState,
  { format, face }: ExportJob,
  quality: number,
) {
  if (!face)
    throw new ValidationError(`${format} export needs a face`, "/face");
  if (state.blocked.has(face.bodyId))
    throw new StoreError(
      `export face depends on unresolved references: ${face.bodyId}`,
      "unprocessable",
    );
  const drawing = asValidation(() => {
    const frame = resolvePlaneFrame(state, { kind: "face", face });
    return faceDrawing(
      state.bodies.get(face.bodyId)!,
      face.faceName,
      frame,
      quality,
    );
  }, "/face");
  return { bodies: [], ...drawing };
}

const SOURCES: Record<
  ExportSource,
  (
    state: EvalState,
    job: ExportJob,
    quality: number,
  ) => Omit<ExportContext, "doc" | "options">
> = {
  bodies: exportBodies,
  sketch: exportSketch,
  face: exportFace,
};

function sourceFor(accepted: ExportSource[], job: ExportJob): ExportSource {
  return job.face && accepted.includes("face") ? "face" : accepted[0]!;
}

export class InProcessKernel implements KernelClient {
  constructor(
    private readonly store: Pick<ProjectStore, "sources">,
    private readonly idle?: () => Promise<void>,
  ) {}

  private async sourced(doc: CadDocument) {
    const engine = engineFor(doc.id);
    return { engine, sources: await this.store.sources(doc, engine.sources) };
  }

  private async stateAt(doc: CadDocument, position?: number) {
    const { engine, sources } = await this.sourced(doc);
    return engine.stateAt(doc, position, sources);
  }

  async evaluate(
    doc: CadDocument,
    position?: number,
    extra?: Sources,
    hooks?: EvaluateHooks,
  ) {
    const { engine, sources } = await this.sourced(doc);
    return engine.evaluate(
      doc,
      position,
      extra ? new Map([...sources, ...extra]) : sources,
      hooks,
    );
  }

  async stateQuery<K extends keyof StateQueries>(
    doc: CadDocument,
    query: StateQuery<K>,
  ) {
    const position = "position" in query ? query.position : undefined;
    const idle = this.idle;
    return ANSWERS[query.kind](
      await this.stateAt(doc, position),
      query,
      doc,
      idle &&
        (async () => {
          await idle();
          return this.stateAt(doc, position);
        }),
    );
  }

  async visibleTargets(
    doc: CadDocument,
    index: number,
    hidden: readonly string[],
  ) {
    const { engine, sources } = await this.sourced(doc);
    return engine.visibleTargets(doc, index, hidden, sources);
  }

  async export(doc: CadDocument, job: ExportJob) {
    const exporter = exporterFor(job.format);
    const state = await this.stateAt(doc);
    const quality = Math.min(Math.max(job.quality ?? EXPORT_QUALITY, 0.001), 1);
    return {
      data: exporter.write({
        doc,
        ...SOURCES[sourceFor([exporter.source].flat(), job)](
          state,
          job,
          quality,
        ),
        options: { quality },
      }),
      mime: exporter.mime,
      ext: exporter.ext,
    };
  }

  async formats() {
    return {
      exporters: exporters
        .list()
        .map(({ format, label, ext, mime, source }) => ({
          format,
          label,
          ext,
          mime,
          source,
        })),
      importers: importers.list().map(({ format, label, extensions }) => ({
        format,
        label,
        extensions,
      })),
    };
  }

  importStep(upload: ImportUpload | undefined) {
    return importFile(upload);
  }

  async planNamingUpgrade(doc: CadDocument, accept?: NamingDecision[]) {
    const { sources } = await this.sourced(doc);
    return planNamingUpgrade(doc, sources, accept);
  }

  drop(docId: string) {
    dropEngine(docId);
  }

  version() {
    return kernelVersion();
  }

  status() {
    return this.version() ? "ready" : "starting";
  }
}
