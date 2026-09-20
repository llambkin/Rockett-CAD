/**
 * Rockett CAD — parametric document model.
 *
 * This schema is the single source of truth for a project. It stores the
 * feature timeline, sketches (with constraints), and references — never
 * final tessellated geometry. Geometry is always regenerated from this model.
 *
 * Schema versioning: bump SCHEMA_VERSION and add a migration in
 * server/src/store/migrations.ts whenever the shape of this model changes.
 */

export const SCHEMA_VERSION = 3;

export type Units = "mm" | "cm" | "m" | "in";

/** Conversion factors to internal geometry units (always millimetres). */
export const UNIT_TO_MM: Record<Units, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

// ---------------------------------------------------------------------------
// Persistent topology references
// ---------------------------------------------------------------------------
//
// Faces, edges and vertices are addressed by *persistent names* assigned by
// the regeneration engine — never by transient array indexes. See
// docs/CAD_MODEL.md ("Topological naming") for the naming scheme.

export interface FaceRef {
  kind: "face";
  bodyId: string;
  faceName: string;
}

export interface EdgeRef {
  kind: "edge";
  bodyId: string;
  edgeName: string;
}

export interface VertexRef {
  kind: "vertex";
  bodyId: string;
  vertexName: string;
}

export type TopoRef = FaceRef | EdgeRef | VertexRef;

export type OriginPlaneName = "XY" | "XZ" | "YZ";

/** Where a sketch / construction plane / mirror plane lives. */
export type PlaneRef =
  | { kind: "origin"; plane: OriginPlaneName }
  | { kind: "construction"; featureId: string }
  | { kind: "face"; face: FaceRef };

/** An axis for revolve / circular pattern. */
export type AxisRef =
  | { kind: "originAxis"; axis: "X" | "Y" | "Z" }
  | { kind: "sketchLine"; sketchId: string; entityId: string }
  | { kind: "edge"; edge: EdgeRef };

// ---------------------------------------------------------------------------
// Sketch geometry
// ---------------------------------------------------------------------------

export interface SketchPoint {
  id: string;
  kind: "point";
  x: number;
  y: number;
  /** True when the point only exists as construction/reference geometry. */
  construction?: boolean;
  /** Projected/external reference — position is driven, not solved. */
  external?: boolean;
}

export interface SketchLine {
  projection?: EdgeRef;
  id: string;
  kind: "line";
  p1: string;
  p2: string;
  construction?: boolean;
  external?: boolean;
}

export interface SketchCircle {
  projection?: EdgeRef;
  id: string;
  kind: "circle";
  center: string;
  radius: number;
  construction?: boolean;
  external?: boolean;
}

/**
 * Arc through center + two endpoint points, counter-clockwise from start to
 * end. The solver adds an implicit |c-s| = |c-e| residual.
 */
export interface SketchArc {
  projection?: EdgeRef;
  id: string;
  kind: "arc";
  center: string;
  start: string;
  end: string;
  construction?: boolean;
  external?: boolean;
}

export type SketchEntity = SketchPoint | SketchLine | SketchCircle | SketchArc;

// ---------------------------------------------------------------------------
// Sketch constraints
// ---------------------------------------------------------------------------

interface ConstraintBase {
  id: string;
  /**
   * User-dragged label position for dimensional constraints, stored as a
   * sketch-UV offset from the default anchor. Display metadata only — the
   * solver ignores it.
   */
  labelOffset?: [number, number];
}

export type GeometricConstraint =
  | (ConstraintBase & { type: "coincident"; a: string; b: string })
  | (ConstraintBase & { type: "horizontal"; line: string })
  | (ConstraintBase & { type: "vertical"; line: string })
  | (ConstraintBase & { type: "parallel"; a: string; b: string })
  | (ConstraintBase & { type: "perpendicular"; a: string; b: string })
  | (ConstraintBase & { type: "tangent"; a: string; b: string })
  | (ConstraintBase & { type: "concentric"; a: string; b: string })
  | (ConstraintBase & { type: "equal"; a: string; b: string })
  | (ConstraintBase & { type: "midpoint"; point: string; line: string })
  | (ConstraintBase & { type: "collinear"; a: string; b: string })
  | (ConstraintBase & { type: "fix"; point: string })
  | (ConstraintBase & { type: "pointOnLine"; point: string; line: string })
  | (ConstraintBase & { type: "pointOnCircle"; point: string; circle: string });

export type DimensionConstraint =
  | (ConstraintBase & {
      type: "distance";
      a: string; // point id
      b: string; // point id
      /** null → direct distance; "x"/"y" → axis-aligned distance */
      axis: "x" | "y" | null;
      value: number; // mm
    })
  | (ConstraintBase & { type: "length"; line: string; value: number })
  | (ConstraintBase & { type: "radius"; entity: string; value: number })
  | (ConstraintBase & { type: "diameter"; entity: string; value: number })
  | (ConstraintBase & { type: "angle"; a: string; b: string; value: number }); // degrees

export type SketchConstraint = GeometricConstraint | DimensionConstraint;

export type SketchSolveStatus =
  | "unconstrained"
  | "partially_constrained"
  | "fully_constrained"
  | "over_constrained";

// ---------------------------------------------------------------------------
// Features (timeline entries)
// ---------------------------------------------------------------------------

export type BooleanOperation = "newBody" | "join" | "cut" | "intersect";

interface FeatureBase {
  id: string;
  name: string;
  suppressed: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  plane: PlaneRef;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  /** false hides the sketch in the viewport (regions not shaded or pickable). */
  visible?: boolean;
}

/** A closed region of a sketch, identified stably by its bounding entity ids. */
export interface ProfileRef {
  sketchId: string;
  /** Stable profile id — hash of sorted outer-loop entity ids. */
  profileId: string;
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  profiles: ProfileRef[];
  /**
   * Planar body faces used directly as extrusion profiles (Fusion-style
   * face extrude / boss from surface). Each face extrudes along its own
   * outward normal.
   */
  faces?: FaceRef[];
  /**
   * Signed distance in mm along the resolved direction; a negative value
   * extrudes to the opposite side (the dialog switches Join → Cut when a
   * negative value is typed, Fusion-style). Never zero.
   */
  distance: number;
  /** Second-side distance for twoSided extrudes (magnitude). */
  distance2?: number;
  /**
   * Start offset in mm along the profile / face normal (Fusion "Start →
   * Offset"): the extrusion begins on a plane this far from the sketch or
   * face instead of on it. Signed; default 0.
   */
  startOffset?: number;
  direction: "normal" | "reverse" | "symmetric" | "twoSided";
  operation: BooleanOperation;
}

export interface RevolveFeature extends FeatureBase {
  type: "revolve";
  profiles: ProfileRef[];
  axis: AxisRef;
  angle: number; // degrees; 360 = full
  operation: BooleanOperation;
}

export interface SweepFeature extends FeatureBase {
  type: "sweep";
  profiles: ProfileRef[];
  /** Path: open chain of sketch entities in the given sketch. */
  pathSketchId: string;
  operation: BooleanOperation;
}

export interface LoftFeature extends FeatureBase {
  type: "loft";
  sections: ProfileRef[];
  operation: BooleanOperation;
}

export interface FilletFeature extends FeatureBase {
  tangentChain?: boolean;
  type: "fillet";
  edges: EdgeRef[];
  radius: number;
}

export interface ChamferFeature extends FeatureBase {
  tangentChain?: boolean;
  type: "chamfer";
  edges: EdgeRef[];
  distance: number;
}

export interface ShellFeature extends FeatureBase {
  type: "shell";
  /** Faces removed (opened). May be empty for a hollow closed shell. */
  openFaces: FaceRef[];
  thickness: number;
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

export interface OffsetFaceFeature extends FeatureBase {
  type: "offsetFace";
  faces: FaceRef[];
  distance: number;
}

export interface MirrorFeature extends FeatureBase {
  type: "mirror";
  bodies: string[];
  plane: PlaneRef;
  /** Join the mirrored result into the source body. */
  combine: boolean;
}

export interface LinearPatternFeature extends FeatureBase {
  type: "linearPattern";
  bodies: string[];
  direction: { kind: "axis"; axis: "X" | "Y" | "Z" } | { kind: "edge"; edge: EdgeRef };
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
    | { kind: "offset"; base: PlaneRef; distance: number }
    | { kind: "midplane"; a: PlaneRef; b: PlaneRef };
}

export interface ReferenceImageFeature extends FeatureBase {
  type: "referenceImage";
  plane: PlaneRef;
  /** Asset id in project assets store. */
  assetId: string;
  /** Original filename, for display. */
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
  visible: boolean;
  /** Natural image size in pixels (for aspect + calibration). */
  width: number;
  height: number;
}

/** Rigid translation of whole bodies (parametric, editable in the timeline). */
export interface MoveFeature extends FeatureBase {
  type: "move";
  bodies: string[];
  translation: [number, number, number];
}

export interface EmbossFeature extends FeatureBase {
  type: "emboss";
  profiles: ProfileRef[];
  depth: number; // positive = emboss (raise), handled with `mode`
  mode: "emboss" | "deboss";
}

export interface ImportStepFeature extends FeatureBase {
  type: "importStep";
  filename: string;
  /** Original STEP source retained so projects remain self-contained. */
  data: string;
}

export type Feature =
  | ImportStepFeature
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

export type FeatureType = Feature["type"];

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface BodyMeta {
  name: string;
  visible: boolean;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  projection: "orthographic" | "perspective";
}

export interface CadDocument {
  schemaVersion: number;
  id: string;
  name: string;
  units: Units;
  createdAt: string;
  modifiedAt: string;
  features: Feature[];
  /**
   * Timeline marker: number of features currently "active" (rolled back when
   * < features.length). New features insert at this position.
   */
  timelinePosition: number;
  /** Display metadata per body id (names, visibility). */
  bodyMeta: Record<string, BodyMeta>;
  /** Per-type counters used for default names (Sketch1, Extrude2, ...). */
  counters: Record<string, number>;
  camera?: CameraState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Unique-enough id generator (time + counter + randomness). */
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 46656;
  const rand = Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, "0");
  const time = Date.now().toString(36);
  const count = idCounter.toString(36).padStart(3, "0");
  return `${prefix}-${time}${count}${rand}`;
}

export const FEATURE_LABELS: Record<FeatureType, string> = {
  importStep: "Import STEP",
  sketch: "Sketch",
  extrude: "Extrude",
  revolve: "Revolve",
  sweep: "Sweep",
  loft: "Loft",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  combine: "Combine",
  splitBody: "SplitBody",
  offsetFace: "OffsetFace",
  mirror: "Mirror",
  linearPattern: "LinearPattern",
  circularPattern: "CircularPattern",
  constructionPlane: "Plane",
  referenceImage: "Canvas",
  emboss: "Emboss",
  move: "Move",
};

/** Allocate the default name for a new feature and bump the counter. */
export function nextFeatureName(doc: CadDocument, type: FeatureType): string {
  const label = FEATURE_LABELS[type];
  const n = (doc.counters[type] ?? 0) + 1;
  doc.counters[type] = n;
  return `${label}${n}`;
}

export function createEmptyDocument(id: string, name: string): CadDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    units: "mm",
    createdAt: now,
    modifiedAt: now,
    features: [],
    timelinePosition: 0,
    bodyMeta: {},
    counters: {},
  };
}

/** Features that can produce/modify solid bodies (used for dependency logic). */
export function featureProducesGeometry(f: Feature): boolean {
  return f.type !== "sketch" && f.type !== "constructionPlane" && f.type !== "referenceImage";
}
