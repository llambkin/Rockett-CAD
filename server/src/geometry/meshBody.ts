import {
  LINEAR_TOL,
  type ImportMeshFeature,
  type MeshSource,
  type NamingVersion,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  faces,
  getKernel,
  progress,
  scoped,
  solids,
  type Shape,
} from "./kernel.js";
import { setExactTriangle } from "./mesh.js";
import {
  compound,
  MAX_MESH_TRIANGLES,
  MESH_READERS,
  solidsOf,
  sourceOf,
  type MeshPart,
} from "./importers.js";
import {
  finalizeNames,
  NameMap,
  namingVersion,
  sortByPosition,
  unnamedPrefix,
  withNamingVersion,
  type NamedBody,
} from "./naming.js";
import { ShapeMap, trackShapeMaps } from "./shapeMap.js";
import {
  registerBodySolids,
  type FeatureOutcome,
  type StateBody,
  type ToolResult,
} from "./featureState.js";
import type { EvalContext } from "./featureKinds.js";
import { V } from "./frames.js";
import { meshCutRefused } from "./cutValidation.js";
import { MESH_LIMITS } from "../tunables.js";

export interface TriangleMesh {
  key: string;
  part: MeshPart;
  corners: Float64Array;
  names: string[];
  outward: 1 | -1;
  bbox: { min: Vec3; max: Vec3 };
  version: NamingVersion;
  built?: ToolResult;
}

function attachTriangle(
  builder: any,
  sewing: any,
  sides: (Shape | null)[],
  corners: number[][],
  normalVector: number[],
): void {
  const k = getKernel();
  scoped((local) => {
    const wire = local(new k.BRepBuilderAPI_MakeWire_4(...sides));
    const origin = local(new k.gp_Pnt_3(...corners[0]!));
    const normal = local(new k.gp_Dir_5(...normalVector));
    const plane = local(new k.gp_Pln_3(origin, normal));
    const make = local(new k.BRepBuilderAPI_MakeFace_3(plane));
    const face = local(make.Face());
    builder.UpdateFace_3(face, LINEAR_TOL);
    setExactTriangle(builder, face, corners);
    builder.Add(face, local(wire.Wire()));
    sewing.Add(face);
  });
}

function placed({ nodes, transform: m }: MeshPart): Float64Array {
  const at = Float64Array.from(nodes);
  if (!m) return at;
  for (let i = 0; i < at.length; i += 3)
    for (let axis = 0; axis < 3; axis++)
      at[i + axis] =
        nodes[i]! * m[axis]! +
        nodes[i + 1]! * m[3 + axis]! +
        nodes[i + 2]! * m[6 + axis]! +
        m[9 + axis]!;
  return at;
}

const cornerOf = (at: ArrayLike<number>, i: number): Vec3 => [
  at[3 * i]!,
  at[3 * i + 1]!,
  at[3 * i + 2]!,
];

function sewTriangles(part: MeshPart): {
  shape: Shape;
  openEdges: number;
} {
  const { triangles } = part;
  const at = placed(part);
  const k = getKernel();
  const result = scoped((own) => {
    const builder = own(new k.BRep_Builder());
    const sewing = own(
      new k.BRepBuilderAPI_Sewing(LINEAR_TOL, true, false, false, false),
    );
    const vertices = new Map<number, Shape>();
    const edges = new Map<number, Shape | null>();
    const count = at.length / 3;
    const point = (i: number): number[] => cornerOf(at, i);
    const vertex = (i: number): Shape => {
      if (!vertices.has(i)) {
        const made = scoped((local) => {
          const p = point(i);
          const pnt = local(new k.gp_Pnt_3(p[0], p[1], p[2]));
          const make = local(new k.BRepBuilderAPI_MakeVertex(pnt));
          return local.keep(local(make.Vertex()));
        });
        vertices.set(i, own(made));
      }
      return vertices.get(i)!;
    };
    const edge = (a: number, b: number): Shape | null => {
      const key = Math.min(a, b) * count + Math.max(a, b);
      if (!edges.has(key)) {
        const made = scoped((local) => {
          const make = local(
            new k.BRepBuilderAPI_MakeEdge_2(
              vertex(Math.min(a, b)),
              vertex(Math.max(a, b)),
            ),
          );
          return make.IsDone() ? local.keep(local(make.Edge())) : null;
        });
        edges.set(key, made && own(made));
      }
      const found = edges.get(key)!;
      if (!found || a < b) return found;
      return own(
        scoped((local) =>
          local.keep(local(k.TopoDS.Edge_1(local(found.Reversed())))),
        ),
      );
    };
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!],
        [p, q, r] = [point(a), point(b), point(c)],
        u = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!],
        v = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!],
        n = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ],
        sides = [edge(a, b), edge(b, c), edge(c, a)];
      if (sides.includes(null) || Math.hypot(n[0]!, n[1]!, n[2]!) === 0)
        continue;
      attachTriangle(builder, sewing, sides, [p, q, r], n);
    }
    sewing.Perform(progress());
    return {
      shape: own.keep(own(sewing.SewedShape())),
      openEdges: sewing.NbFreeEdges(),
    };
  });
  acquire(result.shape);
  return result;
}

function sewParts(
  parts: MeshPart[],
  label: string,
): {
  shape: Shape;
  warning?: string;
} {
  const result = scoped((own) => {
    const pieces = parts.map(sewTriangles);
    const sewn = own(compound(pieces.map((piece) => piece.shape)));
    const openEdges = pieces.reduce((sum, piece) => sum + piece.openEdges, 0);
    if (openEdges > 0)
      return {
        shape: own.keep(sewn),
        warning: `The ${label} mesh is open at ${openEdges} edges, so it imported as a shell, not a solid.`,
      };
    return { shape: own.keep(solidsOf(sewn)) };
  });
  acquire(result.shape);
  return result;
}

let serial = 0;

function closedMesh(part: MeshPart, featureId: string) {
  const at = placed(part),
    count = part.triangles.length / 3,
    nodes = at.length / 3,
    corners = new Float64Array(9 * count),
    owner = new Map<number, number>();
  let volume = 0;
  for (let t = 0; t < count; t++) {
    const ids = [0, 1, 2].map((c) => part.triangles[3 * t + c]!);
    const [p, q, r] = ids.map((i) => cornerOf(at, i)) as [Vec3, Vec3, Vec3];
    const n = V.cross(V.sub(q, p), V.sub(r, p));
    const sides = [V.sub(q, p), V.sub(r, q), V.sub(p, r)];
    if (V.norm(n) === 0 || sides.some((side) => V.norm(side) <= LINEAR_TOL))
      return;
    corners.set([...p, ...q, ...r], 9 * t);
    volume += V.dot(p, n);
    for (let c = 0; c < 3; c++) {
      const edge = ids[c]! * nodes + ids[(c + 1) % 3]!;
      if (owner.has(edge)) return;
      owner.set(edge, t);
    }
  }
  const parent = Int32Array.from({ length: count }, (_, t) => t);
  const root = (t: number) => {
    while (parent[t] !== t) t = parent[t] = parent[parent[t]!]!;
    return t;
  };
  for (const [edge, t] of owner) {
    const twin = owner.get((edge % nodes) * nodes + Math.floor(edge / nodes));
    if (twin === undefined) return;
    parent[root(t)] = root(twin);
  }
  if (parent.some((_, t) => root(t) !== root(0))) return;
  const names: string[] = [];
  const centroid = (t: number) =>
    V.scale(
      [0, 1, 2]
        .map((c) => cornerOf(corners, 3 * t + c))
        .reduce((sum, corner) => V.add(sum, corner)),
      1 / 3,
    );
  sortByPosition(
    Array.from({ length: count }, (_, t) => t),
    centroid,
    namingVersion(),
  ).forEach(({ item, tied }, i) => {
    names[item] = `${unnamedPrefix(featureId)}${tied ? "~?" : ""}${i + 1}`;
  });
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  corners.forEach((x, i) => {
    min[i % 3] = Math.min(min[i % 3]!, x);
    max[i % 3] = Math.max(max[i % 3]!, x);
  });
  const mesh: TriangleMesh = {
    key: `m${++serial}`,
    part,
    corners,
    names,
    outward: volume < 0 ? -1 : 1,
    bbox: { min, max },
    version: namingVersion(),
  };
  return mesh;
}

function triangleNames(mesh: TriangleMesh, shape: Shape): NameMap {
  const keyOf = (at: ArrayLike<number>) =>
    [0, 1, 2]
      .map((i) => cornerOf(at, i).join(","))
      .toSorted()
      .join(" ");
  const byCorners = new Map<string, number[]>();
  mesh.names.forEach((_, t) => {
    const key = keyOf(mesh.corners.subarray(9 * t, 9 * t + 9));
    byCorners.set(key, [...(byCorners.get(key) ?? []), t]);
  });
  const names = new NameMap(mesh.version);
  for (const face of faces(shape)) {
    const at = getKernel().meshFace(face)?.positions ?? [];
    const t = byCorners.get(keyOf(at))?.shift();
    if (t === undefined)
      throw new Error(
        "a mesh triangle was lost converting the mesh to a solid",
      );
    names.set(face, mesh.names[t]!);
  }
  return names;
}

function converted(mesh: TriangleMesh): ToolResult {
  return (mesh.built ??= withNamingVersion(mesh.version, () =>
    trackShapeMaps([], () =>
      scoped((own) => {
        const sewn = own(sewTriangles(mesh.part).shape);
        const shape = own.keep(solids(own(solidsOf(sewn)))[0]!);
        return { shape, names: triangleNames(mesh, shape) };
      }),
    ),
  ));
}

function lazyBody(bodyId: string, mesh: TriangleMesh): StateBody {
  return {
    bodyId,
    mesh,
    get shape() {
      return converted(mesh).shape;
    },
    get names() {
      return converted(mesh).names;
    },
  };
}

export const namesOf = (body: NamedBody): Iterable<string> =>
  body.mesh?.names ?? body.names.values();

export function cutShape(body: NamedBody): Shape {
  const triangles = body.mesh?.names.length ?? 0;
  if (triangles > MESH_LIMITS.cutTriangles)
    throw new Error(meshCutRefused(triangles, MESH_LIMITS.cutTriangles));
  return body.shape;
}

export const boundsOf = (body: NamedBody) =>
  body.mesh?.bbox ?? bboxOf(body.shape);

export function heldParts(body: NamedBody): ToolResult[] {
  if (!body.mesh) return [body];
  return body.mesh.built ? [body.mesh.built] : [];
}

export function drawnTriangles({
  corners,
  names,
  outward,
  bbox,
}: TriangleMesh): MeshSource & { bbox: TriangleMesh["bbox"] } {
  const normals = new Float32Array(corners.length);
  const indices = new Uint32Array(corners.length / 3);
  names.forEach((_, t) => {
    const [p, q, r] = [0, 1, 2].map((c) => cornerOf(corners, 3 * t + c)) as [
      Vec3,
      Vec3,
      Vec3,
    ];
    const n = V.cross(V.sub(q, p), V.sub(r, p));
    const normal = V.scale(n, outward / V.norm(n));
    for (let c = 0; c < 3; c++) normals.set(normal, 9 * t + 3 * c);
    const [b, c] = outward > 0 ? [1, 2] : [2, 1];
    indices.set([3 * t, 3 * t + b, 3 * t + c], 3 * t);
  });
  return {
    positions: corners,
    normals,
    indices,
    triangles: names,
    edges: [],
    vertices: [],
    bbox,
  };
}

export function evalImportMesh(
  { state, sources }: EvalContext,
  feature: ImportMeshFeature,
): FeatureOutcome | void {
  const { label, read } = MESH_READERS[feature.format],
    parts = read(Buffer.from(sourceOf(sources, feature, label))).filter(
      (part) => part.triangles.length > 0,
    ),
    bodyId = `b:${feature.id}`;
  if (parts.length === 0)
    throw new Error(`No mesh found in the ${label} file.`);
  const triangles = parts.reduce(
    (sum, part) => sum + part.triangles.length / 3,
    0,
  );
  if (triangles > MAX_MESH_TRIANGLES)
    throw new Error(
      `The ${label} mesh has ${triangles.toLocaleString("en-US")} triangles; the limit is ${MAX_MESH_TRIANGLES.toLocaleString("en-US")}.`,
    );
  const mesh =
    parts.length === 1 && namingVersion() !== 1
      ? closedMesh(parts[0]!, feature.id)
      : undefined;
  if (mesh) {
    state.bodies.set(bodyId, lazyBody(bodyId, mesh));
    return;
  }
  const { shape, warning } = sewParts(parts, label),
    names = finalizeNames(shape, new ShapeMap(), feature.id);
  if (!warning) return registerBodySolids(state, bodyId, shape, names);
  state.bodies.set(bodyId, { bodyId, shape, names });
  return { warning };
}
