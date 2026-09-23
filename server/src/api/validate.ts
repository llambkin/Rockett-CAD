/**
 * Feature/document validation — modelling parameters are validated before
 * they reach the kernel so the API never executes arbitrary input.
 */

import {
  SCHEMA_VERSION,
  UNIT_TO_MM,
  type CadDocument,
  type Feature,
} from "@rockett/shared";

export class ValidationError extends Error {
  status = 400;
}

function num(v: unknown, label: string, min?: number, max?: number): void {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ValidationError(`${label} must be a finite number`);
  }
  if (min !== undefined && v < min) {
    throw new ValidationError(`${label} must be ≥ ${min}`);
  }
  if (max !== undefined && v > max) {
    throw new ValidationError(`${label} must be ≤ ${max}`);
  }
}

function int(v: unknown, label: string, min?: number, max?: number): void {
  num(v, label, min, max);
  if (!Number.isInteger(v))
    throw new ValidationError(`${label} must be an integer`);
}

function str(v: unknown, label: string, maxLen = 200): void {
  if (typeof v !== "string" || v.length === 0 || v.length > maxLen) {
    throw new ValidationError(
      `${label} must be a non-empty string (≤${maxLen})`,
    );
  }
}

function list(
  v: unknown,
  label: string,
  min: number,
  max: number,
  item: (v: unknown, label: string) => void,
): void {
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    throw new ValidationError(`${label} requires ${min}-${max} items`);
  }
  for (const x of v) item(x, label);
}

function oneOf(v: unknown, label: string, values: readonly string[]): void {
  if (typeof v !== "string" || !values.includes(v)) {
    throw new ValidationError(`${label} must be one of ${values.join(", ")}`);
  }
}

function bool(v: unknown, label: string): void {
  if (typeof v !== "boolean") {
    throw new ValidationError(`${label} must be a boolean`);
  }
}

const OPERATIONS = ["newBody", "join", "cut", "intersect"] as const;

function record(v: unknown, label: string): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ValidationError(`${label} must be an object`);
  }
}

function profileRef(v: unknown, label: string): void {
  record(v, label);
  const ref = v as { sketchId?: unknown; profileId?: unknown };
  str(ref.sketchId, `${label} sketch`, 100);
  str(ref.profileId, `${label} profile`);
}

function faceRef(v: unknown, label: string): void {
  record(v, label);
  const ref = v as { kind?: unknown; bodyId?: unknown; faceName?: unknown };
  if (ref.kind !== "face")
    throw new ValidationError(`${label} must reference a face`);
  str(ref.bodyId, `${label} body`);
  str(ref.faceName, `${label} face`, 2000);
}

function edgeRef(v: unknown, label: string): void {
  record(v, label);
  const ref = v as { kind?: unknown; bodyId?: unknown; edgeName?: unknown };
  if (ref.kind !== "edge")
    throw new ValidationError(`${label} must reference an edge`);
  str(ref.bodyId, `${label} body`);
  str(ref.edgeName, `${label} edge`, 2000);
}

const AXES = ["X", "Y", "Z"] as const;

function planeRef(v: unknown, label: string): void {
  record(v, label);
  const ref = v as {
    kind?: unknown;
    plane?: unknown;
    featureId?: unknown;
    face?: unknown;
  };
  if (ref.kind === "origin")
    oneOf(ref.plane, `${label} origin plane`, ["XY", "XZ", "YZ"]);
  else if (ref.kind === "construction")
    str(ref.featureId, `${label} feature`, 100);
  else if (ref.kind === "face") faceRef(ref.face, `${label} face`);
  else throw new ValidationError(`${label} must be a plane reference`);
}

function axisRef(v: unknown, label: string): void {
  record(v, label);
  const ref = v as {
    kind?: unknown;
    axis?: unknown;
    edge?: unknown;
    sketchId?: unknown;
    entityId?: unknown;
  };
  if (ref.kind === "originAxis") oneOf(ref.axis, `${label} axis`, AXES);
  else if (ref.kind === "edge") edgeRef(ref.edge, `${label} edge`);
  else if (ref.kind === "sketchLine") {
    str(ref.sketchId, `${label} sketch`, 100);
    str(ref.entityId, `${label} line`, 100);
  } else throw new ValidationError(`${label} must be an axis reference`);
}

function directionRef(v: unknown, label: string): void {
  record(v, label);
  const ref = v as { kind?: unknown; axis?: unknown; edge?: unknown };
  if (ref.kind === "axis") oneOf(ref.axis, `${label} axis`, AXES);
  else if (ref.kind === "edge") edgeRef(ref.edge, `${label} edge`);
  else throw new ValidationError(`${label} must be an axis or edge`);
}

const MAX_DIM = 100_000; // 100 m in mm — sanity bound

export function validateFeature(f: Feature): void {
  record(f, "feature");
  str(f.id, "feature id", 100);
  if (f.name !== undefined) str(f.name, "feature name", 120);
  bool(f.suppressed, "feature suppressed");
  switch (f.type) {
    case "importStep":
      str(f.filename, "STEP filename", 255);
      if (
        typeof f.data !== "string" ||
        f.data.length > 10 * 1024 * 1024 ||
        !f.data.trimStart().startsWith("ISO-10303-21;")
      )
        throw new ValidationError("A valid STEP file up to 10 MB is required");
      break;
    case "sketch": {
      planeRef(f.plane, "sketch plane");
      if (!Array.isArray(f.entities) || f.entities.length > 5000) {
        throw new ValidationError("sketch entities invalid");
      }
      if (!Array.isArray(f.constraints) || f.constraints.length > 5000) {
        throw new ValidationError("sketch constraints invalid");
      }
      if (f.offsets !== undefined) {
        if (!Array.isArray(f.offsets) || f.offsets.length > 1000)
          throw new ValidationError("sketch offsets invalid");
        const ids = new Set<string>();
        const outputs = new Set<string>();
        for (const offset of f.offsets) {
          record(offset, "sketch offset");
          str(offset.id, "offset id", 100);
          if (ids.has(offset.id))
            throw new ValidationError("duplicate offset id");
          ids.add(offset.id);
          num(offset.distance, "offset distance", -MAX_DIM, MAX_DIM);
          if (Math.abs(offset.distance) < 1e-7)
            throw new ValidationError("offset distance must be non-zero");
          num(offset.joinTolerance, "offset join tolerance", 0, 1);
          for (const refs of [offset.sourceIds, offset.entityIds]) {
            if (
              !Array.isArray(refs) ||
              !refs.length ||
              refs.length > 5000 ||
              new Set(refs).size !== refs.length
            )
              throw new ValidationError("offset entity references invalid");
            for (const id of refs) str(id, "offset entity id", 100);
          }
          for (const id of offset.entityIds) {
            if (outputs.has(id) || offset.sourceIds.includes(id))
              throw new ValidationError(
                "offset outputs must be distinct from sources and other offsets",
              );
            outputs.add(id);
          }
        }
      }
      if (f.visible !== undefined) bool(f.visible, "sketch visible");
      for (const e of f.entities) record(e, "sketch entity");
      const entityIds = new Set(f.entities.map((e) => e.id));
      if (entityIds.size !== f.entities.length)
        throw new ValidationError("duplicate sketch entity ID");
      const pointIds = new Set(
        f.entities.filter((e) => e.kind === "point").map((e) => e.id),
      );
      for (const e of f.entities) {
        const pointRefs =
          e.kind === "line"
            ? [e.p1, e.p2]
            : e.kind === "circle"
              ? [e.center]
              : e.kind === "arc"
                ? [e.center, e.start, e.end]
                : [];
        if (pointRefs.some((id) => !pointIds.has(id)))
          throw new ValidationError(
            `Missing endpoint on sketch entity ${e.id}`,
          );
        if (e.kind !== "point" && e.projection) {
          edgeRef(e.projection, "projection");
          if (!e.external)
            throw new ValidationError("projected curves must be external");
        }
        if (e.kind === "point") {
          num(e.x, "point x", -MAX_DIM, MAX_DIM);
          num(e.y, "point y", -MAX_DIM, MAX_DIM);
        } else if (e.kind === "circle") {
          num(e.radius, "circle radius", 0, MAX_DIM);
        }
      }
      break;
    }
    case "extrude": {
      // signed: a negative distance extrudes to the other side of the sketch
      num(f.distance, "extrude distance", -MAX_DIM, MAX_DIM);
      if (Math.abs(f.distance) < 0.000001)
        throw new ValidationError("extrude distance must be non-zero");
      oneOf(f.direction, "extrude direction", [
        "normal",
        "reverse",
        "symmetric",
        "twoSided",
      ]);
      oneOf(f.operation, "extrude operation", OPERATIONS);
      if (f.distance2 !== undefined)
        num(f.distance2, "second distance", 0, MAX_DIM);
      if (f.startOffset !== undefined)
        num(f.startOffset, "start offset", -MAX_DIM, MAX_DIM);
      list(f.profiles, "extrude profiles", 0, 64, profileRef);
      if (f.faces !== undefined) list(f.faces, "extrude faces", 0, 64, faceRef);
      const sourceCount = f.profiles.length + (f.faces?.length ?? 0);
      if (sourceCount === 0 || sourceCount > 64) {
        throw new ValidationError("extrude requires 1-64 profiles or faces");
      }
      break;
    }
    case "revolve":
      list(f.profiles, "revolve profiles", 1, 64, profileRef);
      axisRef(f.axis, "revolve axis");
      num(f.angle, "revolve angle", -360, 360);
      oneOf(f.operation, "revolve operation", OPERATIONS);
      break;
    case "sweep":
      list(f.profiles, "sweep profiles", 1, 64, profileRef);
      str(f.pathSketchId, "sweep path sketch", 100);
      oneOf(f.operation, "sweep operation", OPERATIONS);
      break;
    case "loft":
      list(f.sections, "loft sections", 2, 64, profileRef);
      oneOf(f.operation, "loft operation", OPERATIONS);
      break;
    case "fillet":
      if (f.tangentChain !== undefined) bool(f.tangentChain, "tangentChain");
      num(f.radius, "fillet radius", 0.000001, MAX_DIM);
      list(f.edges, "fillet edges", 1, 256, edgeRef);
      break;
    case "chamfer":
      if (f.tangentChain !== undefined) bool(f.tangentChain, "tangentChain");
      num(f.distance, "chamfer distance", 0.000001, MAX_DIM);
      list(f.edges, "chamfer edges", 1, 256, edgeRef);
      break;
    case "shell":
      num(f.thickness, "shell thickness", 0.000001, MAX_DIM);
      list(f.openFaces, "shell open faces", 0, 256, faceRef);
      break;
    case "combine":
      oneOf(f.operation, "combine operation", ["join", "cut", "intersect"]);
      str(f.targetBody, "combine target body");
      list(f.toolBodies, "combine tool bodies", 1, 64, str);
      bool(f.keepTools, "combine keepTools");
      break;
    case "splitBody":
      str(f.body, "split body");
      planeRef(f.tool, "split tool");
      break;
    case "mirror":
      list(f.bodies, "mirror bodies", 1, 64, str);
      planeRef(f.plane, "mirror plane");
      bool(f.combine, "mirror combine");
      break;
    case "linearPattern":
      list(f.bodies, "pattern bodies", 1, 64, str);
      num(f.count, "pattern count", 2, 500);
      directionRef(f.direction, "pattern direction");
      num(f.spacing, "pattern spacing", -MAX_DIM, MAX_DIM);
      bool(f.combine, "pattern combine");
      break;
    case "circularPattern":
      list(f.bodies, "pattern bodies", 1, 64, str);
      num(f.count, "pattern count", 2, 500);
      axisRef(f.axis, "pattern axis");
      num(f.totalAngle, "pattern angle", -360, 360);
      bool(f.combine, "pattern combine");
      break;
    case "constructionPlane":
      record(f.method, "plane method");
      if (f.method.kind === "offset") {
        planeRef(f.method.base, "plane base");
        num(f.method.distance, "plane offset", -MAX_DIM, MAX_DIM);
      } else if (f.method.kind === "midplane") {
        planeRef(f.method.a, "midplane first plane");
        planeRef(f.method.b, "midplane second plane");
      } else
        throw new ValidationError("plane method must be offset or midplane");
      break;
    case "referenceImage":
      planeRef(f.plane, "image plane");
      num(f.opacity, "opacity", 0, 1);
      record(f.transform, "image transform");
      num(f.transform.scale, "image scale", 1e-9, MAX_DIM);
      num(f.width, "image width", 1, 65536);
      num(f.height, "image height", 1, 65536);
      bool(f.visible, "image visible");
      break;
    case "offsetFace":
      num(f.distance, "offset distance", -MAX_DIM, MAX_DIM);
      list(f.faces, "offset faces", 1, 256, faceRef);
      break;
    case "emboss":
      list(f.profiles, "emboss profiles", 1, 64, profileRef);
      num(f.depth, "emboss depth", 0.000001, MAX_DIM);
      oneOf(f.mode, "emboss mode", ["emboss", "deboss"]);
      break;
    case "move":
      list(f.bodies, "move bodies", 1, 64, str);
      list(f.translation, "move translation", 3, 3, (v, label) =>
        num(v, label, -MAX_DIM, MAX_DIM),
      );
      break;
    default: {
      const unknown: never = f;
      throw new ValidationError(
        `unknown feature type ${String((unknown as { type?: unknown }).type)}`,
      );
    }
  }
}

export function validateDocument(doc: CadDocument): void {
  str(doc.id, "document id", 100);
  str(doc.name, "document name", 200);
  if (!Array.isArray(doc.features) || doc.features.length > 2000) {
    throw new ValidationError("features list invalid");
  }
  if (doc.schemaVersion !== SCHEMA_VERSION)
    throw new ValidationError(`schema version must be ${SCHEMA_VERSION}`);
  oneOf(doc.units, "units", Object.keys(UNIT_TO_MM));
  str(doc.createdAt, "createdAt");
  str(doc.modifiedAt, "modifiedAt");
  int(doc.timelinePosition, "timeline position", 0, doc.features.length);
  record(doc.bodyMeta, "body meta");
  for (const meta of Object.values(doc.bodyMeta)) {
    record(meta, "body meta");
    if (typeof meta.name !== "string")
      throw new ValidationError("body name must be a string");
    bool(meta.visible, "body visible");
  }
  record(doc.counters, "counters");
  for (const n of Object.values(doc.counters)) int(n, "counter", 0);
  if (doc.camera !== undefined) {
    record(doc.camera, "camera");
    for (const key of ["position", "target", "up"] as const)
      list(doc.camera[key], `camera ${key}`, 3, 3, num);
    oneOf(doc.camera.projection, "camera projection", [
      "orthographic",
      "perspective",
    ]);
  }
  const ids = new Set<string>();
  for (const f of doc.features) {
    validateFeature(f);
    if (ids.has(f.id))
      throw new ValidationError(`duplicate feature id ${f.id}`);
    ids.add(f.id);
  }
}
