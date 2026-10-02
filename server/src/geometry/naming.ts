import { hash } from "node:crypto";
import {
  compareNames,
  LINEAR_TOL,
  type NamingVersion,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  edgeCentroid,
  faceCentroid,
  faces,
  getKernel,
  listToArray,
  progress,
  scoped,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { ShapeMap } from "./shapeMap.js";

export class NameMap extends ShapeMap<string> {
  constructor(readonly version: NamingVersion) {
    super();
  }
}

let active: NamingVersion = 1;

export function withNamingVersion<T>(version: NamingVersion, run: () => T): T {
  const outer = active;
  active = version;
  try {
    return run();
  } finally {
    active = outer;
  }
}

export function namingVersion(): NamingVersion {
  return active;
}

export interface NamedBody {
  bodyId: string;
  shape: Shape;
  names: NameMap;
}

export function byPosition(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function cell(pos: Vec3): Vec3 {
  return [
    Math.round(pos[0] / LINEAR_TOL),
    Math.round(pos[1] / LINEAR_TOL),
    Math.round(pos[2] / LINEAR_TOL),
  ];
}

function sortByPosition<T>(
  items: T[],
  positionOf: (item: T) => Vec3,
  version: NamingVersion,
): Array<{ item: T; tied: boolean }> {
  const keyOf = version === 1 ? (pos: Vec3) => pos : cell;
  const sorted = items
    .map((item) => ({ item, key: keyOf(positionOf(item)) }))
    .sort((a, b) => byPosition(a.key, b.key));
  return sorted.map(({ item, key }, i) => ({
    item,
    tied:
      version === 2 &&
      [sorted[i - 1], sorted[i + 1]].some(
        (other) => other && byPosition(other.key, key) === 0,
      ),
  }));
}

export function suffixDuplicates<T>(
  groups: Map<string, T[]>,
  positionOf: (item: T) => Vec3,
  version: NamingVersion,
): Array<[T, string]> {
  const named: Array<[T, string]> = [];
  for (const [base, group] of groups) {
    if (group.length === 1) {
      named.push([group[0]!, base]);
      continue;
    }
    sortByPosition(group, positionOf, version).forEach(({ item, tied }, i) =>
      named.push([item, `${base}~${tied ? "?" : ""}${i + 1}`]),
    );
  }
  return named;
}

export interface BodyPiece {
  shape: Shape;
  names: NameMap;
  region?: string;
}

export function orderBodyPieces<T extends BodyPiece>(
  parentId: string,
  pieces: T[],
): T[] {
  return scoped(() => {
    if (pieces.length === 1) return pieces;
    if (pieces[0]!.names.version === 1)
      return pieces
        .map((piece) => ({ piece, v: volumeOf(piece.shape) }))
        .sort((a, b) => b.v - a.v)
        .map(({ piece }) => piece);
    const owned = pieces.map((piece) => {
      const names = new Set(faces(piece.shape).map((f) => piece.names.get(f)));

      names.delete(undefined);
      if (piece.region) names.add(`r:${piece.region}`);
      return [...names] as string[];
    });
    const bearers = new Map<string, number>();
    for (const name of owned.flat())
      bearers.set(name, (bearers.get(name) ?? 0) + 1);
    return pieces
      .map((piece, i) => {
        const own = owned[i]!.filter((n) => bearers.get(n) === 1);
        if (own.length === 0)
          throw new Error(
            `body identity conflict: a piece of ${parentId} has no name of its own`,
          );
        return {
          piece,
          key: own.reduce((a, b) => (compareNames(a, b) <= 0 ? a : b)),
        };
      })
      .sort((a, b) => compareNames(a.key, b.key))
      .map(({ piece }) => piece);
  });
}

export function nameFromEdges(
  shape: Shape,
  provisional: ShapeMap<string>,
  edgeNames: Array<[Shape, string]>,
): void {
  if (active === 1) return;
  const k = getKernel();
  scoped((own) => {
    const midpoints = edgeNames.map(([edge, name]) => {
      const curve = own(new k.BRepAdaptor_Curve_2(edge));
      const at = own(
        curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2),
      );
      return {
        vertex: own(own(new k.BRepBuilderAPI_MakeVertex(at)).Vertex()),
        name,
      };
    });
    const lies = (vertex: Shape, face: Shape) => {
      const dist = own(
        new k.BRepExtrema_DistShapeShape_2(
          vertex,
          face,
          k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
          k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
          progress(),
        ),
      );
      if (!dist.IsDone()) throw new Error("edge naming distance check failed");
      return dist.Value() <= LINEAR_TOL;
    };
    for (const face of faces(shape).map(own)) {
      if (provisional.get(face)) continue;
      const touching = midpoints.filter((m) => lies(m.vertex, face));
      const [first, ...more] = [...new Set(touching.map((m) => m.name))].sort(
        compareNames,
      );
      if (first) provisional.set(face, more.length ? `${first}~?1` : first);
    }
  });
}

export function sweptNames(
  shape: Shape,
  featureId: string,
  edgeNames: Array<[Shape, string]>,
  generated: (edge: Shape) => unknown,
  caps: Shape[],
): NameMap {
  return scoped(() => {
    const k = getKernel();
    const provisional = new ShapeMap<string>();
    for (const [edge, name] of edgeNames) {
      const made = listToArray(generated(edge));
      for (const g of made)
        if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE)
          provisional.set(g, name);
    }
    caps.forEach((cap, i) => {
      for (const face of faces(cap))
        provisional.set(
          face,
          `f:${featureId}:cap:${i === 0 ? "start" : "end"}`,
        );
    });
    nameFromEdges(shape, provisional, edgeNames);

    return finalizeNames(shape, provisional, featureId);
  });
}

/** Assign fallback names + disambiguate duplicates. Returns final NameMap. */
export function finalizeNames(
  shape: Shape,
  provisional: ShapeMap<string>,
  featureId: string,
): NameMap {
  return scoped(() => {
    const allFaces = faces(shape);
    // Group by provisional name
    const byName = new Map<string, Shape[]>();
    const unnamed: Shape[] = [];
    for (const f of allFaces) {
      const n = provisional.get(f);
      if (n) {
        const arr = byName.get(n) ?? [];
        arr.push(f);
        byName.set(n, arr);
      } else {
        unnamed.push(f);
      }
    }
    const result = new NameMap(active);
    for (const [f, name] of suffixDuplicates(byName, faceCentroid, active)) {
      result.set(f, name);
    }
    if (unnamed.length > 0) {
      const sorted = sortByPosition(unnamed, faceCentroid, active);
      // fallback numbers skip names already present, so a feature that names
      // its faces in several passes never hands out the same name twice
      const taken = new Set(result.values());
      let n = 0;
      for (const { item: face, tied } of sorted) {
        let name: string;
        do name = `f:${featureId}:x${tied ? "~?" : ""}${++n}`;
        while (taken.has(name));
        taken.add(name);
        result.set(face, name);
      }
    }
    return result;
  });
}

/**
 * Propagate names from input shapes through an operation exposing the
 * standard OCCT history API (Modified / Generated / IsDeleted).
 */
export function propagateNames(
  op: any,
  inputs: Array<{ shape: Shape; names: ShapeMap<string> }>,
  resultShape: Shape,
  featureId: string,
): NameMap {
  return scoped(() => {
    const provisional = new ShapeMap<string>();
    for (const input of inputs) {
      const inputFaces = faces(input.shape);
      for (const f of inputFaces) {
        const name = input.names.get(f);
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
            provisional.set(mf, name);
            mapped = true;
          }
        } catch {
          // no modification info
        }
        if (!mapped) {
          // face may survive unchanged (same TShape) in the result
          provisional.set(f, name);
        }
      }
    }
    return finalizeNames(resultShape, provisional, featureId);
  });
}

/**
 * Propagate names through a BRepTools_History (ShapeUpgrade_UnifySameDomain
 * and friends). Several input faces may merge into one result face: it takes
 * their shared base name with the ~n split suffix dropped, or the first
 * distinct base name in sorted order when they differ.
 */
export function historyNames(
  history: any,
  input: { shape: Shape; names: ShapeMap<string> },
  resultShape: Shape,
  featureId: string,
): NameMap {
  return scoped(() => {
    const candidates = new ShapeMap<string[]>();
    for (const f of faces(input.shape)) {
      const name = input.names.get(f);
      if (!name) continue;
      if (history.IsRemoved(f)) continue;
      const targets = listToArray(history.Modified(f));
      for (const t of targets.length > 0 ? targets : [f]) {
        const arr = candidates.get(t) ?? [];
        arr.push(name);
        candidates.set(t, arr);
      }
    }

    const provisional = new ShapeMap<string>();
    for (const [face, names] of candidates.entries()) {
      const bases = [
        ...new Set(names.map((n) => n.replace(/~\??\d+$/, ""))),
      ].sort();
      provisional.set(face, bases[0]!);
    }
    return finalizeNames(resultShape, provisional, featureId);
  });
}

const nameKey = (name: string) => hash("sha256", name).slice(0, 16);

export function instanceName(
  prefix: string,
  name: string,
  version: NamingVersion,
): string {
  if (!prefix) return name;
  if (version === 1) return `${prefix}:${name}`;
  const suffix = /(?:~\??\d+)*$/.exec(name)![0];
  return `${prefix}:${nameKey(name.slice(0, name.length - suffix.length))}${suffix}`;
}

export function edgeName(faceNames: string[]): string {
  const sorted = [...new Set(faceNames)].sort();
  return sorted.length >= 2
    ? `e[${sorted.join("|")}]`
    : `e[${sorted[0] ?? "?"}|seam]`;
}

/** Copy names through a BRepBuilderAPI_Transform (ModifiedShape API). */
export function transformNames(
  transformOp: any,
  input: { shape: Shape; names: NameMap },
  prefix: string,
): NameMap {
  return scoped(() => {
    const out = new NameMap(input.names.version);
    for (const f of faces(input.shape)) {
      const name = input.names.get(f);
      try {
        if (name) {
          const mf = acquire(transformOp.ModifiedShape(f));
          out.set(mf, instanceName(prefix, name, out.version));
        }
      } catch {
        // ignore
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Edge / vertex naming from adjacent faces
// ---------------------------------------------------------------------------

export interface EdgeNames {
  /** persistent edge name → edge shape */
  byName: Map<string, Shape>;
}

export interface VertexNames {
  byName: Map<string, Shape>;
}

export function computeEdgeNames(body: NamedBody): EdgeNames {
  const result = scoped((own) => {
    const k = getKernel();
    const map = acquire(new k.TopTools_IndexedDataMapOfShapeListOfShape_1());
    k.TopExp.MapShapesAndAncestors(
      body.shape,
      k.TopAbs_ShapeEnum.TopAbs_EDGE,
      k.TopAbs_ShapeEnum.TopAbs_FACE,
      map,
    );
    interface Entry {
      edge: Shape;
      base: string;
    }
    const entries: Entry[] = [];
    const n = map.Extent();
    for (let i = 1; i <= n; i++) {
      const key = acquire(map.FindKey_2(i));
      const edge = acquire(k.TopoDS.Edge_1(key));
      const faceList = listToArray(map.FindFromIndex_2(i));
      const base = edgeName(
        faceList.map((f: Shape) => body.names.get(f) ?? "?"),
      );
      entries.push({ edge, base });
    }

    // Disambiguate identical base names deterministically.
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const arr = groups.get(e.base) ?? [];
      arr.push(e);
      groups.set(e.base, arr);
    }
    const named = suffixDuplicates(
      groups,
      (entry) => {
        try {
          return edgeCentroid(entry.edge);
        } catch {
          return [0, 0, 0];
        }
      },
      body.names.version,
    ).map(([e, name]) => [name, own.keep(e.edge)] as const);
    return { byName: new Map(named.sort(([a], [b]) => compareNames(a, b))) };
  });
  for (const edge of result.byName.values()) acquire(edge);
  return result;
}

export type VertexFaces = { faces: string[]; position: Vec3 };

export function vertexFaces(body: NamedBody) {
  const result = scoped((own) => {
    const k = getKernel();
    const map = acquire(new k.TopTools_IndexedDataMapOfShapeListOfShape_1());
    k.TopExp.MapShapesAndAncestors(
      body.shape,
      k.TopAbs_ShapeEnum.TopAbs_VERTEX,
      k.TopAbs_ShapeEnum.TopAbs_FACE,
      map,
    );
    const entries: Array<VertexFaces & { vertex: Shape }> = [];
    const n = map.Extent();
    for (let i = 1; i <= n; i++) {
      const key = acquire(map.FindKey_2(i));
      const vertex = acquire(k.TopoDS.Vertex_1(key));
      const faceList = listToArray(map.FindFromIndex_2(i));
      const names = faceList.map((f: Shape) => body.names.get(f) ?? "?");
      const p = acquire(k.BRep_Tool.Pnt(vertex));
      const position: Vec3 = [p.X(), p.Y(), p.Z()];
      entries.push({ vertex: own.keep(vertex), faces: names, position });
    }
    return entries;
  });
  for (const entry of result) acquire(entry.vertex);
  return result;
}

export function nameVertices<T extends VertexFaces>(
  entries: T[],
  version: NamingVersion,
): Array<[T, string]> {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const joined = [...new Set(e.faces)].sort().join("|");
    const base = `v[${version === 1 ? joined : nameKey(joined)}]`;
    groups.set(base, [...(groups.get(base) ?? []), e]);
  }
  return suffixDuplicates(groups, (e) => e.position, version);
}

export function computeVertexNames(body: NamedBody): VertexNames {
  const byName = new Map<string, Shape>();
  for (const [e, name] of nameVertices(vertexFaces(body), body.names.version))
    byName.set(name, e.vertex);
  return { byName };
}

/** Find a face in a body by persistent name. */
export function findFace(body: NamedBody, faceName: string): Shape | null {
  const found = scoped((own) => {
    for (const face of faces(body.shape))
      if (body.names.get(face) === faceName) return own.keep(face);
    return null;
  });
  return found && acquire(found);
}
