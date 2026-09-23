/**
 * API DTOs shared between server and client.
 */

import type { CadDocument, SketchSolveStatus, SketchEntity } from "./model.js";
import type { Profile } from "./profiles.js";

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
    | { type: "other" };
}

export interface VertexInfo {
  name: string;
  position: Vec3;
}

export interface BodyPayload {
  bodyId: string;
  name: string;
  visible: boolean;
  meshKey: string;
  positions: number[];
  normals: number[];
  indices: number[];
  faces: FaceInfo[];
  edges: EdgeInfo[];
  vertices: VertexInfo[];
  bbox: { min: Vec3; max: Vec3 };
}

export type FeatureRunStatus =
  "ok" | "warning" | "error" | "suppressed" | "rolledBack";

export interface FeatureStatus {
  featureId: string;
  status: FeatureRunStatus;
  error?: string;
  warning?: string;
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

export interface ProjectSummary {
  id: string;
  name: string;
  modifiedAt: string;
  createdAt: string;
  featureCount: number;
  status: "ok" | "invalid" | "tooNew";
  error?: string;
  schemaVersion?: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FolderTree {
  folders: Folder[];
  placement: Record<string, string>;
}

export interface MeasureRequest {
  refs: Array<
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
    radius?: number;
    diameter?: number;
    position?: Vec3;
  }>;
}

export interface ExportRequest {
  format: "stl" | "3mf";
  bodyIds: string[]; // empty = all visible bodies
  /** Linear tessellation tolerance in mm (default 0.05). */
  quality?: number;
  /** Also store a copy under the project's exports/ directory. */
  retain?: boolean;
}

export type ApiErrorCode =
  | "validation"
  | "not_found"
  | "too_large"
  | "conflict"
  | "unprocessable"
  | "kernel"
  | "internal";

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  detail?: string;
}

export interface ProjectResponse {
  document: CadDocument;
}
