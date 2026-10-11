import type { Static } from "typebox";
import type { FEATURE_SCHEMAS } from "./schema/features.js";
import type { SketchFitSpline, SketchSpline } from "./splineModel.js";
import type { ExtrudeExtent, ExtrudeThin } from "./extrudeModel.js";
import type { SketchConstraint } from "./constraintModel.js";
export type { SketchFitSpline, SketchSpline } from "./splineModel.js";
export * from "./extrudeModel.js";
export * from "./constraintModel.js";

export type NamingVersion = 1 | 2;

export interface FaceRef {
  kind: "face";
  bodyId: string;
  faceName: string;
  sig?: RefSignature;
}

export interface EdgeRef {
  kind: "edge";
  bodyId: string;
  edgeName: string;
  sig?: RefSignature;
}

export interface VertexRef {
  kind: "vertex";
  bodyId: string;
  vertexName: string;
}

export type TopoRef = FaceRef | EdgeRef | VertexRef;

export interface SketchEntityRef {
  kind: "sketchEntity";
  sketchId: string;
  entityId: string;
}

export type BodyRef = { kind: "body"; bodyId: string };

export type SectionRef = { kind: "section"; of: FaceRef | BodyRef };

export type ProjectionRef =
  EdgeRef | FaceRef | SketchEntityRef | BodyRef | SectionRef;

export type PointRef =
  VertexRef | { kind: "sketchPoint"; sketchId: string; entityId: string };

export const REF_SIGNATURE_TYPES = [
  "plane",
  "cylinder",
  "cone",
  "sphere",
  "torus",
  "bspline",
  "line",
  "circle",
  "other",
] as const;

export interface RefSignature {
  type: (typeof REF_SIGNATURE_TYPES)[number];
  point: [number, number, number];
  direction: [number, number, number];
}

export type OriginPlaneName = "XY" | "XZ" | "YZ";

export type PlaneRef =
  | { kind: "origin"; plane: OriginPlaneName }
  | { kind: "construction"; featureId: string }
  | { kind: "face"; face: FaceRef };

export const ORIGIN_AXES = ["X", "Y", "Z"] as const;
export const SHELL_DIRECTIONS = ["inside", "outside", "both"] as const;
export type ShellDirection = (typeof SHELL_DIRECTIONS)[number];
export const CHAMFER_TYPES = [
  "equalDistance",
  "twoDistances",
  "distanceAngle",
] as const;
export type ChamferType = (typeof CHAMFER_TYPES)[number];
export const FILLET_TYPES = [
  "equalDistance",
  "twoDistances",
  "variableRadius",
] as const;
export type FilletType = (typeof FILLET_TYPES)[number];
export type OriginAxis = (typeof ORIGIN_AXES)[number];

export type AxisRef =
  | { kind: "originAxis"; axis: OriginAxis }
  | { kind: "sketchLine"; sketchId: string; entityId: string }
  | { kind: "edge"; edge: EdgeRef };

export interface SketchPoint {
  id: string;
  kind: "point";
  x: number;
  y: number;
  construction?: boolean;
  external?: boolean;
}

export interface SketchLine {
  projection?: ProjectionRef;
  id: string;
  kind: "line";
  p1: string;
  p2: string;
  construction?: boolean;
  external?: boolean;
}

export interface SketchCircle {
  projection?: ProjectionRef;
  id: string;
  kind: "circle";
  center: string;
  radius: number;
  construction?: boolean;
  external?: boolean;
}

export interface SketchArc {
  projection?: ProjectionRef;
  id: string;
  kind: "arc";
  center: string;
  start: string;
  end: string;
  construction?: boolean;
  external?: boolean;
}

export interface SketchEllipse {
  projection?: ProjectionRef;
  id: string;
  kind: "ellipse";
  center: string;
  major: string;
  minor: string;
  start?: string;
  end?: string;
  construction?: boolean;
  external?: boolean;
}

export type SketchEntity =
  | SketchPoint
  | SketchLine
  | SketchCircle
  | SketchArc
  | SketchEllipse
  | SketchSpline
  | SketchFitSpline;

export type BooleanOperation = "newBody" | "join" | "cut" | "intersect";

interface FeatureBase {
  id: string;
  name: string;
  suppressed: boolean;
}

export interface AutoTargets {
  exclude: string[];
  features: string[];
}

interface ToolFeatureBase extends FeatureBase {
  targets?: string[];
  autoTargets?: AutoTargets;
}

interface BlendFeatureBase extends FeatureBase {
  tangentChain?: boolean;
  edges: EdgeRef[];
  faces?: FaceRef[];
  features?: string[];
}

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  plane: PlaneRef;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  offsets?: SketchOffset[];
}

export interface SketchOffset {
  id: string;
  distance: number;
  sourceIds: string[];
  entityIds: string[];
  joinTolerance: number;
}

/** A closed region of a sketch, identified stably by its bounding entity ids. */
export interface ProfileRef {
  sketchId: string;
  /** Stable profile id — hash of sorted outer-loop entity ids. */
  profileId: string;
}

export interface ExtrudeFeature extends ToolFeatureBase {
  type: "extrude";
  profiles: ProfileRef[];
  faces?: FaceRef[];
  curves?: SketchEntityRef[];
  distance: number;
  distance2?: number;
  startOffset?: number;
  startObject?: PlaneRef;
  extent?: ExtrudeExtent;
  taper?: number;
  taper2?: number;
  thin?: ExtrudeThin;
  direction: "normal" | "reverse" | "symmetric" | "twoSided";
  operation: BooleanOperation;
}

export interface RevolveFeature extends ToolFeatureBase {
  type: "revolve";
  profiles: ProfileRef[];
  faces?: FaceRef[];
  axis: AxisRef;
  angle: number; // degrees; 360 = full
  operation: BooleanOperation;
}

export interface SweepFeature extends ToolFeatureBase {
  type: "sweep";
  profiles: ProfileRef[];
  pathSketchId: string;
  operation: BooleanOperation;
}

export interface LoftFeature extends ToolFeatureBase {
  type: "loft";
  sections: (ProfileRef | FaceRef)[];
  operation: BooleanOperation;
}

export interface FilletFeature extends BlendFeatureBase {
  type: "fillet";
  filletType: FilletType;
  radius: number;
  distance2?: number;
  endRadius?: number;
  flip?: boolean;
  betweenFaces?: FaceRef[];
  betweenFeatures?: string[];
  sets?: FilletSet[];
}

export type FilletSet = Pick<
  FilletFeature,
  "edges" | "faces" | "features" | "betweenFaces" | "betweenFeatures" | "radius"
>;

export interface ChamferFeature extends BlendFeatureBase {
  type: "chamfer";
  chamferType: ChamferType;
  distance: number;
  distance2?: number;
  angle?: number;
  flip?: boolean;
}

export interface ShellFeature extends FeatureBase {
  type: "shell";
  openFaces: FaceRef[];
  body?: string;
  direction: ShellDirection;
  thickness: number;
  outsideThickness?: number;
}

export interface CombineFeature extends FeatureBase {
  type: "combine";
  operation: "join" | "cut" | "intersect";
  targetBody: string;
  toolBodies: string[];
  keepTools: boolean;
}

export interface SplitBodyFeature extends FeatureBase {
  type: "splitBody";
  body: string;
  tool: PlaneRef;
}

export type OffsetFaceFeature = Static<typeof FEATURE_SCHEMAS.offsetFace>;

export interface MirrorFeature extends FeatureBase {
  type: "mirror";
  bodies: string[];
  plane: PlaneRef;
  combine: boolean;
}

export interface LinearPatternFeature extends FeatureBase {
  type: "linearPattern";
  bodies: string[];
  direction:
    { kind: "axis"; axis: OriginAxis } | { kind: "edge"; edge: EdgeRef };
  count: number;
  spacing: number; // mm
  combine: boolean;
}

export interface CircularPatternFeature extends FeatureBase {
  type: "circularPattern";
  bodies: string[];
  axis: AxisRef;
  count: number;
  totalAngle: number; // degrees
  combine: boolean;
}

export interface ConstructionPlaneFeature extends FeatureBase {
  type: "constructionPlane";
  method:
    | { kind: "offset"; base: PlaneRef; distance: number; flip?: boolean }
    | {
        kind: "midplane";
        a: PlaneRef;
        b: PlaneRef;
        offset?: number;
        flip?: boolean;
      }
    | { kind: "angle"; axis: AxisRef; base: PlaneRef; angle: number }
    | { kind: "threePoints"; points: [PointRef, PointRef, PointRef] }
    | { kind: "twoEdges"; a: AxisRef; b: AxisRef };
}

export interface ReferenceImageFeature extends FeatureBase {
  type: "referenceImage";
  plane: PlaneRef;
  assetId: string;
  fileName: string;
  /** Placement on the plane, in sketch (u,v) coordinates. */
  transform: {
    u: number;
    v: number;
    rotation: number; // degrees
    /** mm per image pixel */
    scale: number;
  };
  opacity: number; // 0..1
  width: number;
  height: number;
}

export interface MoveFeature extends FeatureBase {
  type: "move";
  bodies: string[];
  translation: [number, number, number];
  axis: AxisRef;
  angle: number;
  copy: boolean;
}

export interface EmbossFeature extends ToolFeatureBase {
  type: "emboss";
  profiles: ProfileRef[];
  depth: number; // positive = emboss (raise), handled with `mode`
  mode: "emboss" | "deboss";
}

export interface ImportStepFeature extends FeatureBase {
  type: "importStep";
  filename: string;
  format?: "iges" | "brep";
  blob: string;
}

export interface ImportMeshFeature extends FeatureBase {
  type: "importMesh";
  filename: string;
  format: "stl" | "obj" | "3mf";
  blob: string;
}

export type ExtensionType = `${string}.${string}`;

export interface ExtensionFeature<
  P = Record<string, unknown>,
> extends FeatureBase {
  type: ExtensionType;
  version: number;
  params: P;
}

export type CoreFeature =
  | ImportStepFeature
  | ImportMeshFeature
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | SweepFeature
  | LoftFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | CombineFeature
  | SplitBodyFeature
  | OffsetFaceFeature
  | MirrorFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | ConstructionPlaneFeature
  | ReferenceImageFeature
  | EmbossFeature
  | MoveFeature;

export type Feature = CoreFeature | ExtensionFeature;

export type FeatureType = CoreFeature["type"];

export * from "./documents.js";

let idCounter = 0;

export function normalizeDegrees(value: number): number {
  const wrapped = value - 360 * Math.floor(value / 360);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 46656;
  const rand = Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, "0");
  const time = Date.now().toString(36);
  const count = idCounter.toString(36).padStart(3, "0");
  return `${prefix}-${time}${count}${rand}`;
}
