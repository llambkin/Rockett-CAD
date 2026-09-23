/**
 * Feature/document validation — modelling parameters are validated before
 * they reach the kernel so the API never executes arbitrary input.
 */

import type { CadDocument, Feature } from "@rockett/shared";

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

function str(v: unknown, label: string, maxLen = 200): void {
  if (typeof v !== "string" || v.length === 0 || v.length > maxLen) {
    throw new ValidationError(`${label} must be a non-empty string (≤${maxLen})`);
  }
}

function list(v: unknown, label: string, min: number, max: number): void {
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    throw new ValidationError(`${label} requires ${min}-${max} items`);
  }
}

function planeRef(v: unknown, label: string): void {
  const kind = (v as { kind?: unknown } | null)?.kind;
  if (kind !== "origin" && kind !== "construction" && kind !== "face") {
    throw new ValidationError(`${label} must be a plane reference`);
  }
}

const MAX_DIM = 100_000; // 100 m in mm — sanity bound

export function validateFeature(f: Feature): void {
  str(f.id, "feature id", 100);
  if (f.name !== undefined) str(f.name, "feature name", 120);
  switch (f.type) {
    case "importStep":
      str(f.filename, "STEP filename", 255);
      if (typeof f.data !== "string" || f.data.length > 10 * 1024 * 1024 || !f.data.trimStart().startsWith("ISO-10303-21;"))
        throw new ValidationError("A valid STEP file up to 10 MB is required");
      break;
    case "sketch": {
      if (!Array.isArray(f.entities) || f.entities.length > 5000) {
        throw new ValidationError("sketch entities invalid");
      }
      if (!Array.isArray(f.constraints) || f.constraints.length > 5000) {
        throw new ValidationError("sketch constraints invalid");
      }
      if (f.offsets !== undefined) {
        if (!Array.isArray(f.offsets) || f.offsets.length > 1000) throw new ValidationError("sketch offsets invalid");
        const ids = new Set<string>();
        const outputs = new Set<string>();
        for (const offset of f.offsets) {
          if (!offset) throw new ValidationError("sketch offset invalid");
          str(offset.id, "offset id", 100);
          if (ids.has(offset.id)) throw new ValidationError("duplicate offset id");
          ids.add(offset.id);
          num(offset.distance, "offset distance", -MAX_DIM, MAX_DIM);
          if (Math.abs(offset.distance) < 1e-7) throw new ValidationError("offset distance must be non-zero");
          num(offset.joinTolerance, "offset join tolerance", 0, 1);
          for (const refs of [offset.sourceIds, offset.entityIds]) {
            if (!Array.isArray(refs) || !refs.length || refs.length > 5000 || new Set(refs).size !== refs.length)
              throw new ValidationError("offset entity references invalid");
            for (const id of refs) str(id, "offset entity id", 100);
          }
          for (const id of offset.entityIds) {
            if (outputs.has(id) || offset.sourceIds.includes(id)) throw new ValidationError("offset outputs must be distinct from sources and other offsets");
            outputs.add(id);
          }
        }
      }
      if (f.visible !== undefined && typeof f.visible !== "boolean") {
        throw new ValidationError("sketch visible must be a boolean");
      }
      const entityIds = new Set(f.entities.map(e => e.id));
      if (entityIds.size !== f.entities.length) throw new ValidationError("duplicate sketch entity ID");
      const pointIds = new Set(f.entities.filter(e => e.kind === "point").map(e => e.id));
      for (const e of f.entities) {
        const pointRefs = e.kind === "line" ? [e.p1, e.p2] : e.kind === "circle" ? [e.center]
          : e.kind === "arc" ? [e.center, e.start, e.end] : [];
        if (pointRefs.some(id => !pointIds.has(id))) throw new ValidationError(`Missing endpoint on sketch entity ${e.id}`);
        if (e.kind !== "point" && e.projection) {
          if (e.projection.kind !== "edge") throw new ValidationError("projection must reference an edge");
          str(e.projection.bodyId, "projection body");
          str(e.projection.edgeName, "projection edge", 2000);
          if (!e.external) throw new ValidationError("projected curves must be external");
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
      if (Math.abs(f.distance) < 0.000001) throw new ValidationError("extrude distance must be non-zero");
      if (f.distance2 !== undefined) num(f.distance2, "second distance", 0, MAX_DIM);
      if (f.startOffset !== undefined) num(f.startOffset, "start offset", -MAX_DIM, MAX_DIM);
      list(f.profiles, "extrude profiles", 0, 64);
      if (f.faces !== undefined) list(f.faces, "extrude faces", 0, 64);
      const sourceCount = f.profiles.length + (f.faces?.length ?? 0);
      if (sourceCount === 0 || sourceCount > 64) {
        throw new ValidationError("extrude requires 1-64 profiles or faces");
      }
      break;
    }
    case "revolve":
      num(f.angle, "revolve angle", -360, 360);
      break;
    case "sweep":
      list(f.profiles, "sweep profiles", 1, 64);
      str(f.pathSketchId, "sweep path sketch", 100);
      break;
    case "loft":
      list(f.sections, "loft sections", 2, 64);
      break;
    case "fillet":
      if (f.tangentChain !== undefined && typeof f.tangentChain !== "boolean") throw new ValidationError("tangentChain must be boolean");
      num(f.radius, "fillet radius", 0.000001, MAX_DIM);
      list(f.edges, "fillet edges", 1, 256);
      break;
    case "chamfer":
      if (f.tangentChain !== undefined && typeof f.tangentChain !== "boolean") throw new ValidationError("tangentChain must be boolean");
      num(f.distance, "chamfer distance", 0.000001, MAX_DIM);
      list(f.edges, "chamfer edges", 1, 256);
      break;
    case "shell":
      num(f.thickness, "shell thickness", 0.000001, MAX_DIM);
      break;
    case "combine":
      if (!["join", "cut", "intersect"].includes(f.operation)) {
        throw new ValidationError("combine operation must be join, cut or intersect");
      }
      str(f.targetBody, "combine target body");
      list(f.toolBodies, "combine tool bodies", 1, 64);
      for (const id of f.toolBodies) str(id, "combine tool body");
      break;
    case "splitBody":
      str(f.body, "split body");
      planeRef(f.tool, "split tool");
      break;
    case "mirror":
      list(f.bodies, "mirror bodies", 1, 64);
      for (const id of f.bodies) str(id, "mirror body");
      planeRef(f.plane, "mirror plane");
      break;
    case "linearPattern":
      num(f.count, "pattern count", 2, 500);
      num(f.spacing, "pattern spacing", -MAX_DIM, MAX_DIM);
      break;
    case "circularPattern":
      num(f.count, "pattern count", 2, 500);
      num(f.totalAngle, "pattern angle", -360, 360);
      break;
    case "constructionPlane":
      if (f.method.kind === "offset") {
        num(f.method.distance, "plane offset", -MAX_DIM, MAX_DIM);
      }
      break;
    case "referenceImage":
      num(f.opacity, "opacity", 0, 1);
      num(f.transform.scale, "image scale", 1e-9, MAX_DIM);
      num(f.width, "image width", 1, 65536);
      num(f.height, "image height", 1, 65536);
      break;
    case "offsetFace":
      num(f.distance, "offset distance", -MAX_DIM, MAX_DIM);
      break;
    case "emboss":
      num(f.depth, "emboss depth", 0.000001, MAX_DIM);
      break;
    case "move":
      list(f.bodies, "move bodies", 1, 64);
      list(f.translation, "move translation", 3, 3);
      num(f.translation[0], "move X", -MAX_DIM, MAX_DIM);
      num(f.translation[1], "move Y", -MAX_DIM, MAX_DIM);
      num(f.translation[2], "move Z", -MAX_DIM, MAX_DIM);
      break;
    default: {
      const unknown: never = f;
      throw new ValidationError(`unknown feature type ${String((unknown as { type?: unknown }).type)}`);
    }
  }
}

export function validateDocument(doc: CadDocument): void {
  str(doc.id, "document id", 100);
  str(doc.name, "document name", 200);
  if (!Array.isArray(doc.features) || doc.features.length > 2000) {
    throw new ValidationError("features list invalid");
  }
  num(doc.timelinePosition, "timeline position", 0, doc.features.length);
  const ids = new Set<string>();
  for (const f of doc.features) {
    if (ids.has(f.id)) throw new ValidationError(`duplicate feature id ${f.id}`);
    ids.add(f.id);
    validateFeature(f);
  }
}
