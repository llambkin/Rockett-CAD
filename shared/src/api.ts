/**
 * API DTOs shared between server and client.
 */

import type {
  CadDocument,
  EdgeRef,
  FaceRef,
  Feature,
  NamingVersion,
  ProjectMember,
  SketchSolveStatus,
  SketchEntity,
} from "./model.js";
import type { BSpline } from "./bspline.js";
import type { Profile } from "./profiles.js";
import type { SettingTypes } from "./settings.js";

export type Vec3 = [number, number, number];

/** A 3D coordinate frame for a sketch plane / construction plane. */
export interface PlaneFrame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
}

export interface FaceInfo {
  /** Persistent face name. */
  name: string;
  /** First index into the body index buffer. */
  start: number;
  /** Number of indices. */
  count: number;
  surface:
    | { type: "plane"; origin: Vec3; normal: Vec3 }
    | { type: "cylinder"; origin: Vec3; axis: Vec3; radius: number }
    | { type: "other" };
  area: number;
}

export interface EdgeInfo {
  /** Persistent edge name. */
  name: string;
  /** Sampled polyline [x,y,z,...]. */
  polyline: number[];
  length: number;
  curve:
    | { type: "line"; a: Vec3; b: Vec3 }
    | {
        type: "circle";
        center: Vec3;
        axis: Vec3;
        radius: number;
        start?: Vec3;
        end?: Vec3;
        sweep?: number;
      }
    | {
        type: "ellipse";
        center: Vec3;
        axis: Vec3;
        majorAxis: Vec3;
        majorRadius: number;
        minorRadius: number;
        start?: Vec3;
        end?: Vec3;
        sweep?: number;
      }
    | { type: "other" };
}

export type ExactCurve =
  | EdgeInfo["curve"]
  | ({ type: "bspline"; poles: Vec3[] } & Omit<BSpline, "poles">);

export const BOUNDARY_NOT_COPIED = "boundary-not-copied";

export interface VertexInfo {
  name: string;
  position: Vec3;
}

export interface MeshPayload {
  positions: number[];
  normals: number[];
  indices: number[];
  faces: FaceInfo[];
  edges: EdgeInfo[];
  vertices: VertexInfo[];
}

export interface BodyPayload {
  bodyId: string;
  name: string;
  color?: string;
  reference?: true;
  approximate?: true;
  meshKey: string;
  mesh?: { hash: string; bytes: number };
  coarse?: { hash: string; bytes: number };
  bbox: { min: Vec3; max: Vec3 };
}

export type MeshedBody = BodyPayload & MeshPayload;

export type FeatureRunStatus =
  "ok" | "warning" | "error" | "suppressed" | "rolledBack" | "cancelled";

export interface RefCandidate {
  bodyId: string;
  name: string;
  basis: "lineage" | "signature";
}

export interface RefProblem {
  status: "candidate" | "ambiguous" | "missing";
  candidates: RefCandidate[];
  suggestions: RefCandidate[];
}

export type RefResolution = { status: "resolved" } | RefProblem;

export interface UnresolvedRef extends RefProblem {
  ref: FaceRef | EdgeRef;
}

export interface NamingTarget {
  bodyId: string;
  name?: string;
}

export type NamingMesh = Pick<BodyPayload, "bbox"> &
  (
    | ({ kind: "body" | "face" } & Pick<FaceInfo, "start" | "count">)
    | ({ kind: "edge" } & Pick<EdgeInfo, "polyline">)
  );

export interface NamingCandidate extends NamingTarget {
  basis: RefCandidate["basis"];
  mesh?: NamingMesh;
}

export interface NamingDecision {
  featureId: string | null;
  path: string;
  to: NamingTarget;
}

export interface NamingMapping {
  featureId: string | null;
  path: string;
  from: NamingTarget;
  status: "proven" | RefProblem["status"];
  to?: NamingTarget;
  candidates: NamingCandidate[];
  suggestions: NamingCandidate[];
}

export interface NamingFailure extends Pick<
  FeatureStatus,
  "featureId" | "refs"
> {
  namingVersion: NamingVersion;
  error: string;
}

export interface NamingUpgradeProposal {
  backup: string;
  revision: number;
  mappings: NamingMapping[];
  failures?: NamingFailure[];
}

export interface ImportNode {
  name?: string;
  path: number[];
  bodyIds: string[];
  children: ImportNode[];
}

export interface FeatureStatus {
  featureId: string;
  status: FeatureRunStatus;
  error?: string;
  bodyId?: string;
  warning?: string;
  targets?: string[];
  refs?: UnresolvedRef[];
  modified?: Record<string, string[]>;
  importTree?: ImportNode[];
}

export interface SketchPayload {
  featureId: string;
  frame: PlaneFrame;
  /** Solved entity positions (authoritative after regeneration). */
  entities: SketchEntity[];
  solveStatus: SketchSolveStatus;
  dof: number;
  profiles: Profile[];
}

export interface ConstructionPlanePayload {
  featureId: string;
  frame: PlaneFrame;
  /** Suggested display half-size (mm). */
  size: number;
}

export interface EvaluateResult {
  bodies: BodyPayload[];
  featureStatuses: FeatureStatus[];
  sketches: SketchPayload[];
  planes: ConstructionPlanePayload[];
  /** Milliseconds spent in the kernel. */
  kernelMs: number;
}

export interface MeshedEvaluation extends EvaluateResult {
  bodies: MeshedBody[];
}

export interface ProjectSummary {
  id: string;
  owner?: string | null;
  ownerName?: string | null;
  name: string;
  modifiedAt: string;
  modifiedBy: string | null;
  createdAt: string;
  featureCount: number;
  revision?: number;
  deleteTag?: string;
  status: "ok" | "invalid" | "tooNew";
  error?: string;
  schemaVersion?: number;
}

export const VIEW_VERSION = 2;

export interface ViewCamera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  projection: SettingTypes["view.projection"];
}

export interface ProjectView {
  version: typeof VIEW_VERSION;
  hidden: { bodies: string[]; features: string[] };
  camera: ViewCamera | null;
}

export interface Visibility {
  bodies: Record<string, boolean>;
  features: Record<string, boolean>;
}

export function emptyView(): ProjectView {
  return {
    version: VIEW_VERSION,
    hidden: { bodies: [], features: [] },
    camera: null,
  };
}

function applyShown(ids: string[], flags: Record<string, boolean>): string[] {
  if (Object.keys(flags).length === 0) return ids;
  const hidden = new Set(ids);
  for (const [id, visible] of Object.entries(flags))
    if (visible) hidden.delete(id);
    else hidden.add(id);
  return [...hidden];
}

export function withShown(view: ProjectView, shown: Visibility): ProjectView {
  return {
    ...view,
    hidden: {
      bodies: applyShown(view.hidden.bodies, shown.bodies),
      features: applyShown(view.hidden.features, shown.features),
    },
  };
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  owner: string | null;
  members: ProjectMember[];
}

export interface FolderTree {
  folders: Folder[];
  placement: Record<string, string>;
}

export const MEASURE_MAX_REFS = 1000;

export interface MeasureRequest {
  refs: Array<
    | { kind: "body"; bodyId: string }
    | { kind: "face"; bodyId: string; faceName: string }
    | { kind: "edge"; bodyId: string; edgeName: string }
    | { kind: "vertex"; bodyId: string; vertexName: string }
  >;
}

export interface MeasureResult {
  /** Minimum distance between the two selections (when 2 refs). */
  distance?: number;
  deltaX?: number;
  deltaY?: number;
  deltaZ?: number;
  angleDeg?: number;
  /** Per-selection info. */
  items: Array<{
    kind: string;
    length?: number;
    area?: number;
    volume?: number;
    radius?: number;
    diameter?: number;
    position?: Vec3;
  }>;
}

export type ExportSource = "bodies" | "sketch" | "face";

export interface ExportFormat {
  format: string;
  label: string;
  ext: string;
  mime: string;
  source: ExportSource | ExportSource[];
}

export interface ImportFormat {
  format: string;
  label: string;
  extensions: string[];
}

export const importLabels = (formats: readonly ImportFormat[]) =>
  new Intl.ListFormat("en-GB", { type: "disjunction" }).format(
    formats.map((format) => format.label),
  );

export interface Formats {
  exporters: ExportFormat[];
  importers: ImportFormat[];
}

export type ModuleStatus = "loaded" | "failed" | "incompatible" | "disabled";

export interface ModuleInfo {
  id: string;
  name: string;
  version: string;
  licence: string;
  author: string;
  status: ModuleStatus;
  error: string | null;
  client?: true;
}

export const SIZE_KEYS = {
  fillet: "radius",
  chamfer: "distance",
  shell: "thickness",
  extrude: "distance",
  linearPattern: "spacing",
  offsetFace: "distance",
} as const;

export type SizedFeature = Extract<Feature, { type: keyof typeof SIZE_KEYS }>;

export interface SizeLimitRequest {
  feature: SizedFeature;
}

export type SizeLimit = { builds: number } & (
  | { kind: "upTo"; size: number }
  | { kind: "smooth" }
  | { kind: "none"; below: number }
  | { kind: "stopped"; below: number }
  | { kind: "stopped"; size: number }
  | { kind: "slow" }
  | { kind: "untouched" }
);

export interface ExportRequest {
  format: string;
  bodyIds: string[]; // empty = all visible bodies
  sketchId?: string;
  face?: FaceRef;
  /** Linear tessellation tolerance in mm (default 0.05). */
  quality?: number;
  /** Also store a copy under the project's exports/ directory. */
  retain?: boolean;
}

export type ApiErrorCode =
  | "validation"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "conflict"
  | "precondition_required"
  | "unprocessable"
  | "kernel"
  | "kept"
  | "internal";

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  detail?: string;
  revision?: number;
  draft?: CadDocument;
}

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface HistoryMark {
  label: string;
  at: string;
  snapshot: string;
  by?: string;
  byName?: string;
}

export interface HistoryList {
  entries: HistoryMark[];
  position: number;
  checkpoints: HistoryMark[];
}

export interface BlobCollection {
  dryRun: boolean;
  skipped: string | null;
  kept: number;
  orphans: string[];
}

export interface ProjectResponse {
  document: CadDocument;
}

export interface OpenedProject extends ProjectResponse {
  access: ProjectMember["role"];
}
