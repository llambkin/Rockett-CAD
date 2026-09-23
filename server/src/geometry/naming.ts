/**
 * Persistent topology naming.
 *
 * Every face of every body carries a persistent string name assigned when the
 * face is first created and propagated through subsequent operations using
 * the kernel's Modified/Generated/IsDeleted history. Edges and vertices are
 * named from their adjacent faces, so they inherit stability from face names.
 *
 * Naming scheme (see docs/CAD_MODEL.md):
 *   face   f:{featureId}:s:{sketchEntityId}   extrude/revolve side face
 *          f:{featureId}:cap:start|end        extrude/revolve caps
 *          f:{featureId}:fe:{n}               fillet/chamfer face from edge
 *          f:{featureId}:x{n}                 fallback (deterministic order)
 *   edge   e[{faceA}|{faceB}]                 adjacent faces, sorted
 *   vertex v[{faceA}|{faceB}|{faceC}]         adjacent faces, sorted
 *
 * When several subshapes end up with the same base name (e.g. a boolean
 * splits a face in two) they are disambiguated with a deterministic ~n
 * suffix ordered by centroid.
 */

import type { Vec3 } from "@rockett/shared";
import {
  edgeCentroid,
  faceCentroid,
  faces,
  getKernel,
  listToArray,
  release,
  shapeHash,
  type Shape,
} from "./kernel.js";

/** face hash → persistent name for one body state. */
export type NameMap = Map<number, string>;

export interface NamedBody {
  bodyId: string;
  shape: Shape;
  names: NameMap;
}

export function byPosition(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function suffixDuplicates<T>(
  groups: Map<string, T[]>,
  positionOf: (item: T) => Vec3,
): Array<[T, string]> {
  const named: Array<[T, string]> = [];
  for (const [base, group] of groups) {
    if (group.length === 1) {
      named.push([group[0]!, base]);
      continue;
    }
    group
      .map((item) => ({ item, pos: positionOf(item) }))
      .sort((a, b) => byPosition(a.pos, b.pos))
      .forEach(({ item }, i) => named.push([item, `${base}~${i + 1}`]));
  }
  return named;
}

/** Assign fallback names + disambiguate duplicates. Returns final NameMap. */
export function finalizeNames(
  shape: Shape,
  provisional: NameMap,
  featureId: string,
): NameMap {
  const allFaces = faces(shape);
  try {
    // Group by provisional name
    const byName = new Map<string, Shape[]>();
    const unnamed: Shape[] = [];
    for (const f of allFaces) {
      const n = provisional.get(shapeHash(f));
      if (n) {
        const arr = byName.get(n) ?? [];
        arr.push(f);
        byName.set(n, arr);
      } else {
        unnamed.push(f);
      }
    }
    const result: NameMap = new Map();
    for (const [f, name] of suffixDuplicates(byName, faceCentroid)) {
      result.set(shapeHash(f), name);
    }
    if (unnamed.length > 0) {
      const sorted = unnamed
        .map((f) => ({ f, c: faceCentroid(f) }))
        .sort((a, b) => byPosition(a.c, b.c));
      // fallback numbers skip names already present, so a feature that names
      // its faces in several passes never hands out the same name twice
      const taken = new Set(result.values());
      let n = 0;
      for (const item of sorted) {
        let name: string;
        do name = `f:${featureId}:x${++n}`;
        while (taken.has(name));
        taken.add(name);
        result.set(shapeHash(item.f), name);
      }
    }
    return result;
  } finally {
    release(allFaces);
  }
}

/**
 * Propagate names from input shapes through an operation exposing the
 * standard OCCT history API (Modified / Generated / IsDeleted).
 */
export function propagateNames(
  op: any,
  inputs: Array<{ shape: Shape; names: NameMap }>,
  resultShape: Shape,
  featureId: string,
): NameMap {
  const provisional: NameMap = new Map();
  for (const input of inputs) {
    const inputFaces = faces(input.shape);
    try {
      for (const f of inputFaces) {
        const name = input.names.get(shapeHash(f));
        if (!name) continue;
        let mapped = false;
        try {
          if (op.IsDeleted(f)) continue;
        } catch {
          // some ops throw on unknown shapes — treat as not deleted
        }
        try {
          const arr = listToArray(op.Modified(f));
          for (const mf of arr) {
            provisional.set(shapeHash(mf), name);
            mapped = true;
          }
          release(arr);
        } catch {
          // no modification info
        }
        if (!mapped) {
          // face may survive unchanged (same TShape) in the result
          provisional.set(shapeHash(f), name);
        }
      }
    } finally {
      release(inputFaces);
    }
  }
  return finalizeNames(resultShape, provisional, featureId);
}

/**
 * Propagate names through a BRepTools_History (ShapeUpgrade_UnifySameDomain
 * and friends). Several input faces may merge into one result face: it takes
 * their shared base name with the ~n split suffix dropped, or the first
 * distinct base name in sorted order when they differ.
 */
export function historyNames(
  history: any,
  input: { shape: Shape; names: NameMap },
  resultShape: Shape,
  featureId: string,
): NameMap {
  const candidates = new Map<number, string[]>();
  const inputFaces = faces(input.shape);
  try {
    for (const f of inputFaces) {
      const name = input.names.get(shapeHash(f));
      if (!name) continue;
      if (history.IsRemoved(f)) continue;
      const targets = listToArray(history.Modified(f));
      for (const t of targets.length > 0 ? targets : [f]) {
        const arr = candidates.get(shapeHash(t)) ?? [];
        arr.push(name);
        candidates.set(shapeHash(t), arr);
      }
      release(targets);
    }
  } finally {
    release(inputFaces);
  }
  const provisional: NameMap = new Map();
  for (const [hash, names] of candidates) {
    const bases = [...new Set(names.map((n) => n.replace(/~\d+$/, "")))].sort();
    provisional.set(hash, bases[0]!);
  }
  return finalizeNames(resultShape, provisional, featureId);
}

/** Copy names through a BRepBuilderAPI_Transform (ModifiedShape API). */
export function transformNames(
  transformOp: any,
  input: { shape: Shape; names: NameMap },
  prefix: string,
): NameMap {
  const out: NameMap = new Map();
  for (const f of faces(input.shape)) {
    const name = input.names.get(shapeHash(f));
    try {
      if (name) {
        const mf = transformOp.ModifiedShape(f);
        out.set(shapeHash(mf), prefix ? `${prefix}:${name}` : name);
        mf.delete();
      }
    } catch {
      // ignore
    }
    f.delete();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edge / vertex naming from adjacent faces
// ---------------------------------------------------------------------------

export interface EdgeNames {
  /** edge hash → persistent edge name */
  byHash: Map<number, string>;
  /** persistent edge name → edge shape */
  byName: Map<string, Shape>;
}

export interface VertexNames {
  byHash: Map<number, string>;
  byName: Map<string, Shape>;
}

export function computeEdgeNames(body: NamedBody): EdgeNames {
  const k = getKernel();
  const map = new k.TopTools_IndexedDataMapOfShapeListOfShape_1();
  k.TopExp.MapShapesAndAncestors(
    body.shape,
    k.TopAbs_ShapeEnum.TopAbs_EDGE,
    k.TopAbs_ShapeEnum.TopAbs_FACE,
    map,
  );
  interface Entry {
    edge: Shape;
    base: string;
    centroid: [number, number, number];
  }
  const entries: Entry[] = [];
  const n = map.Extent();
  for (let i = 1; i <= n; i++) {
    const key = map.FindKey(i);
    const edge = k.TopoDS.Edge_1(key);
    key.delete();
    const faceList = listToArray(map.FindFromIndex(i));
    const faceNames = [
      ...new Set(
        faceList.map((f: Shape) => body.names.get(shapeHash(f)) ?? "?"),
      ),
    ].sort();
    release(faceList);
    const base =
      faceNames.length >= 2
        ? `e[${faceNames.join("|")}]`
        : `e[${faceNames[0] ?? "?"}|seam]`;
    let centroid: [number, number, number];
    try {
      centroid = edgeCentroid(edge);
    } catch {
      centroid = [0, 0, 0];
    }
    entries.push({ edge, base, centroid });
  }
  map.delete();

  // Disambiguate identical base names deterministically.
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = groups.get(e.base) ?? [];
    arr.push(e);
    groups.set(e.base, arr);
  }
  const byHash = new Map<number, string>();
  const byName = new Map<string, Shape>();
  for (const [e, name] of suffixDuplicates(groups, (entry) => entry.centroid)) {
    byHash.set(shapeHash(e.edge), name);
    byName.set(name, e.edge);
  }
  return { byHash, byName };
}

export function computeVertexNames(body: NamedBody): VertexNames {
  const k = getKernel();
  const map = new k.TopTools_IndexedDataMapOfShapeListOfShape_1();
  k.TopExp.MapShapesAndAncestors(
    body.shape,
    k.TopAbs_ShapeEnum.TopAbs_VERTEX,
    k.TopAbs_ShapeEnum.TopAbs_FACE,
    map,
  );
  interface Entry {
    vertex: Shape;
    base: string;
    pos: [number, number, number];
  }
  const entries: Entry[] = [];
  const n = map.Extent();
  for (let i = 1; i <= n; i++) {
    const key = map.FindKey(i);
    const vertex = k.TopoDS.Vertex_1(key);
    key.delete();
    const faceList = listToArray(map.FindFromIndex(i));
    const faceNames = [
      ...new Set(
        faceList.map((f: Shape) => body.names.get(shapeHash(f)) ?? "?"),
      ),
    ].sort();
    release(faceList);
    const p = k.BRep_Tool.Pnt(vertex);
    const pos: [number, number, number] = [p.X(), p.Y(), p.Z()];
    p.delete();
    entries.push({ vertex, base: `v[${faceNames.join("|")}]`, pos });
  }
  map.delete();

  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = groups.get(e.base) ?? [];
    arr.push(e);
    groups.set(e.base, arr);
  }
  const byHash = new Map<number, string>();
  const byName = new Map<string, Shape>();
  for (const [e, name] of suffixDuplicates(groups, (entry) => entry.pos)) {
    byHash.set(shapeHash(e.vertex), name);
    byName.set(name, e.vertex);
  }
  return { byHash, byName };
}

/** Find a face in a body by persistent name. */
export function findFace(body: NamedBody, faceName: string): Shape | null {
  let found: Shape | null = null;
  for (const f of faces(body.shape)) {
    if (!found && body.names.get(shapeHash(f)) === faceName) found = f;
    else f.delete();
  }
  return found;
}
