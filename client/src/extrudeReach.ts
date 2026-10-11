import { ShapeUtils, Vector2, Vector3 } from "three";
import { cellsMeetSolid } from "./extrudeOverlap";
import {
  faceRegions,
  findProfile,
  LINEAR_TOL,
  pointInPolygon,
  uncovered,
  type BodyPayload,
  type FaceInfo,
  type MeshPayload,
  type PlaneFrame,
  type SketchPayload,
  type Vec3,
} from "@rockett/shared";
import type { PreviewGhost } from "./livePreview";
import { meshOf, type LayerBody } from "./three/meshes";
import {
  previewBodies,
  previewedFeature,
  useStore,
  type Selection,
} from "./store";

interface Base {
  triangles: Vec3[][];
  normal: Vec3;
}

interface Bounds {
  min: Vec3;
  max: Vec3;
}

function framePoints(
  { origin: o, xAxis: x, yAxis: y }: PlaneFrame,
  polygon: number[],
): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    const u = polygon[i]!;
    const v = polygon[i + 1]!;
    points.push([
      o[0] + u * x[0] + v * y[0],
      o[1] + u * x[1] + v * y[1],
      o[2] + u * x[2] + v * y[2],
    ]);
  }
  return points;
}

function profileBase(
  sel: { sketchId: string; profileId: string },
  sketches: SketchPayload[],
): Base | null {
  const sketch = sketches.find((s) => s.featureId === sel.sketchId);
  const profile = sketch && findProfile(sketch, sel.profileId);
  if (!sketch || !profile) return null;
  const rings = [profile.polygon, ...profile.holePolygons].map((p) =>
    Array.from(
      { length: p.length / 2 },
      (_, i) => new Vector2(p[i * 2]!, p[i * 2 + 1]!),
    ),
  );
  const points = rings.flat();
  return {
    triangles: ShapeUtils.triangulateShape(rings[0]!, rings.slice(1)).map(
      (tri) =>
        framePoints(
          sketch.frame,
          tri.flatMap((i) => [points[i]!.x, points[i]!.y]),
        ),
    ),
    normal: sketch.frame.normal,
  };
}

function faceBase(
  sel: { bodyId: string; faceName: string },
  bodies: BodyPayload[],
): Base | null {
  const found = bodies.find((b) => b.bodyId === sel.bodyId);
  const body = found && meshOf(found);
  const face = body?.faces.find((f) => f.name === sel.faceName);
  if (!body || !face || face.surface.type !== "plane") return null;
  const triangles: Vec3[][] = [];
  for (let i = face.start; i + 2 < face.start + face.count; i += 3)
    triangles.push(
      body.indices
        .slice(i, i + 3)
        .map((v): Vec3 => [
          body.positions[v * 3]!,
          body.positions[v * 3 + 1]!,
          body.positions[v * 3 + 2]!,
        ]),
    );
  return { triangles, normal: face.surface.normal };
}

export function toolBase(sel: Selection): Base | null {
  const s = useStore.getState();
  return sel.kind === "profile"
    ? profileBase(sel, s.evaluation?.sketches ?? [])
    : sel.kind === "face"
      ? faceBase(sel, previewBodies(s))
      : null;
}

const shifted = (p: Vec3, by: Vec3, t = 1): Vec3 => [
  p[0] + by[0] * t,
  p[1] + by[1] * t,
  p[2] + by[2] * t,
];

export function movedCells(triangles: Vec3[][], by: Vec3): Vec3[][] {
  return triangles.map((tri) => [...tri, ...tri.map((p) => shifted(p, by))]);
}

const TURN_STEP = Math.PI / 24;

export function turnedCells(
  triangles: Vec3[][],
  origin: Vec3,
  axis: Vec3,
  angle: number,
): Vec3[][] {
  const o = new Vector3(...origin);
  const dir = new Vector3(...axis).normalize();
  const steps = Math.max(1, Math.ceil(Math.abs(angle) / TURN_STEP));
  const step = angle / steps;
  const turn = (p: Vec3, a: number, reach = 1): Vec3 => {
    const v = new Vector3(...p).sub(o).applyAxisAngle(dir, a);
    const along = dir.clone().multiplyScalar(v.dot(dir));
    return v.sub(along).multiplyScalar(reach).add(along).add(o).toArray();
  };
  return triangles.flatMap((tri) =>
    Array.from({ length: steps }, (_, i) => [
      ...tri.map((p) => turn(p, i * step)),
      ...tri.map((p) => turn(p, (i + 0.5) * step, 1 / Math.cos(step / 2))),
      ...tri.map((p) => turn(p, (i + 1) * step)),
    ]),
  );
}

function swept(
  { points, normal }: { points: Vec3[]; normal: Vec3 },
  from: number,
  to: number,
): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (const t of [from, to])
      for (let i = 0; i < 3; i++) {
        const v = p[i]! + normal[i]! * t;
        min[i] = Math.min(min[i]!, v);
        max[i] = Math.max(max[i]!, v);
      }
  return { min, max };
}

function span(
  direction: string,
  distance: number,
  start: number,
  distance2: number,
): [number, number] {
  const d = direction === "reverse" ? -distance : distance;
  const back = Math.sign(d) * Math.abs(distance2);
  return direction === "symmetric"
    ? [start - Math.abs(d) / 2, start + Math.abs(d) / 2]
    : direction === "twoSided"
      ? [start - back, start + d]
      : [start, start + d];
}

type ToolOperation = "newBody" | "join" | "cut";

export function toolOperation(cells: Vec3[][], into = false): ToolOperation {
  const bodies = previewBodies(useStore.getState());
  if (into && bodies.some((b) => cellsMeetSolid(cells, b, -LINEAR_TOL)))
    return "cut";
  return bodies.some((b) => cellsMeetSolid(cells, b, LINEAR_TOL))
    ? "join"
    : "newBody";
}

export function autoOperation(
  params: {
    operation?: string | undefined;
    autoOperation?: boolean | undefined;
  },
  operation: () => ToolOperation,
) {
  if (params.operation !== undefined && !params.autoOperation) return undefined;
  const next = operation();
  return next === params.operation
    ? undefined
    : { operation: next, autoOperation: true };
}

export function extrudeOperation(
  direction: string,
  distance: number,
  start: number,
  distance2: number,
): ToolOperation {
  const [from, to] = span(direction, distance, start, distance2);
  const into = to < from && (direction === "normal" || direction === "reverse");
  const cells = useStore.getState().selection.flatMap((sel) => {
    const base = toolBase(sel);
    if (!base) return [];
    const { triangles, normal } = base;
    return movedCells(
      triangles.map((tri) => tri.map((p) => shifted(p, normal, from))),
      shifted([0, 0, 0], normal, to - from),
    );
  });
  return toolOperation(cells, into);
}

function across([a, b, c]: Vec3[]): Vec3 {
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]] as const;
  const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]] as const;
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

interface Mesh {
  positions: number[];
  normals: number[];
}

function triangle(out: Mesh, points: Vec3[]) {
  const n = across(points);
  const size = Math.hypot(...n) || 1;
  for (const p of points) {
    out.positions.push(...p);
    out.normals.push(n[0] / size, n[1] / size, n[2] / size);
  }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const flatten = (ring: Vector2[]) => ring.flatMap((q) => [q.x, q.y]);

function faceLoops(body: MeshPayload, face: FaceInfo, normal: Vec3) {
  const at = (v: number): Vec3 => [
    body.positions[v * 3]!,
    body.positions[v * 3 + 1]!,
    body.positions[v * 3 + 2]!,
  ];
  const open = new Map<string, [Vec3, Vec3]>();
  for (let i = face.start; i + 2 < face.start + face.count; i += 3) {
    const tri = body.indices.slice(i, i + 3).map(at);
    if (dot(across(tri), normal) < 0) tri.reverse();
    for (const [k, u] of tri.entries()) {
      const w = tri[(k + 1) % 3]!;
      if (!open.delete(`${w} ${u}`)) open.set(`${u} ${w}`, [u, w]);
    }
  }
  const next = new Map([...open.values()].map(([u, w]) => [`${u}`, w]));
  const loops: Vec3[][] = [];
  for (const start of next.keys()) {
    const loop: Vec3[] = [];
    let key = start;
    for (let p = next.get(key); p && next.delete(key); p = next.get(key)) {
      loop.push(p);
      key = `${p}`;
    }
    loops.push(loop);
  }
  return loops;
}

function gap(q: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, q.clone().sub(a).dot(ab) / ab.lengthSq()));
  return q.distanceTo(a.clone().addScaledVector(ab, t));
}

function holeRings(
  [outer, ...holes]: Vector2[][],
  face: PlaneFrame,
  sketches: SketchPayload[],
): Vector2[][] {
  const rings = [outer!, ...holes];
  const polygons = rings.map(flatten);
  const inside = (u: number, v: number) => {
    const q = new Vector2(u, v);
    return (
      polygons.filter((p) => pointInPolygon(u, v, p)).length % 2 === 1 &&
      rings.every((r) =>
        r.every((a, k) => gap(q, a, r[(k + 1) % r.length]!) > LINEAR_TOL),
      )
    );
  };
  const all = [
    ...holes,
    ...faceRegions(face, sketches, inside).map(({ outline }) =>
      Array.from(
        { length: outline.length / 2 },
        (_, i) => new Vector2(outline[i * 2], outline[i * 2 + 1]),
      ),
    ),
  ];
  const flat = all.map(flatten);
  const kept = new Set(uncovered(flat));
  return all.filter((_, i) => kept.has(flat[i]!));
}

interface Section {
  key: string;
  loops: Vec3[][];
  normal: Vec3;
  sketches: SketchPayload[];
}

function prism(
  { loops, normal, sketches }: Section,
  [low, high]: number[],
  out: Mesh,
) {
  const depth = dot(loops[0]![0]!, normal);
  const side = across([
    [0, 0, 0],
    normal,
    normal[0] ** 2 < 0.5 ? [1, 0, 0] : [0, 1, 0],
  ]);
  const e1 = side.map((v) => v / Math.hypot(...side)) as Vec3;
  const e2 = across([[0, 0, 0], normal, e1]);
  const where = new Map<Vector2, Vec3>();
  const flat = (p: Vec3) => {
    const q = new Vector2(dot(p, e1), dot(p, e2));
    where.set(q, p);
    return q;
  };
  const lift = (q: Vector2, t = 0) =>
    (
      where.get(q) ??
      e1.map((v, i) => v * q.x + e2[i]! * q.y + normal[i]! * depth)
    ).map((v, i) => v + normal[i]! * t) as Vec3;
  const rings = loops
    .map((l) => l.map(flat))
    .toSorted(
      (a, b) => Math.abs(ShapeUtils.area(b)) - Math.abs(ShapeUtils.area(a)),
    );
  const face = {
    origin: normal.map((v) => v * depth) as Vec3,
    xAxis: e1,
    yAxis: e2,
    normal,
  };
  const [outer, ...holes] = [
    rings[0]!,
    ...holeRings(rings, face, sketches),
  ].map((r, i) =>
    ShapeUtils.isClockWise(r) === (i === 0) ? r.toReversed() : r,
  );
  const caps = ShapeUtils.triangulateShape(outer!, holes);
  const points = [outer!, ...holes].flat();
  for (const tri of caps) {
    const ring = tri.map((i) => points[i]!);
    if (ShapeUtils.isClockWise(ring)) ring.reverse();
    triangle(
      out,
      ring.map((q) => lift(q, high)),
    );
    triangle(
      out,
      ring.toReversed().map((q) => lift(q, low)),
    );
  }
  for (const ring of [outer!, ...holes])
    for (const [k, a] of ring.entries()) {
      const b = ring[(k + 1) % ring.length]!;
      triangle(out, [lift(a, low), lift(b, low), lift(b, high)]);
      triangle(out, [lift(a, low), lift(b, high), lift(a, high)]);
    }
}

export function extrudeGhosts(ghosts: PreviewGhost[]): PreviewGhost[] {
  const s = useStore.getState();
  const feature = previewedFeature(s);
  const bodies = previewBodies(s);
  const tint = ghosts[0]?.tint;
  if (!tint || feature?.type !== "extrude" || feature.operation === "intersect")
    return ghosts;
  const ends = span(
    feature.direction,
    feature.distance,
    feature.startOffset ?? 0,
    feature.distance2 ?? 0,
  ).toSorted((a, b) => a - b);
  const order = (id: string) =>
    s.document!.features.findIndex((f) => f.id === id);
  const sketches = (s.evaluation?.sketches ?? []).filter(
    (k) => order(k.featureId) < order(feature.id),
  );
  const found = [
    ...feature.profiles.map((ref): Section | undefined => {
      const sketch = s.evaluation?.sketches.find(
        (k) => k.featureId === ref.sketchId,
      );
      const profile = sketch && findProfile(sketch, ref.profileId);
      if (!profile) return undefined;
      return {
        key: `${ref.sketchId} ${ref.profileId}`,
        loops: [profile.polygon, ...profile.holePolygons].map((p) =>
          framePoints(sketch.frame, p),
        ),
        normal: sketch.frame.normal,
        sketches: [],
      };
    }),
    ...(feature.faces ?? []).map((ref): Section | undefined => {
      const body = bodies.find((b) => b.bodyId === ref.bodyId);
      const shape = body && meshOf(body);
      const face = shape?.faces.find((f) => f.name === ref.faceName);
      if (!body || !shape || face?.surface.type !== "plane") return undefined;
      return {
        key: `${body.meshKey} ${face.name}`,
        loops: faceLoops(shape, face, face.surface.normal),
        normal: face.surface.normal,
        sketches,
      };
    }),
  ];
  const sections = found.filter((c) => c !== undefined);
  if (!found.length || sections.length < found.length) return ghosts;
  const out: Mesh = { positions: [], normals: [] };
  for (const section of sections) prism(section, ends, out);
  const boxes = sections.map(({ loops, normal }) =>
    swept({ points: loops.flat(), normal }, ends[0]!, ends[1]!),
  );
  const corner = (pick: (b: Bounds) => Vec3, f: typeof Math.min) =>
    [0, 1, 2].map((i) => f(...boxes.map((b) => pick(b)[i]!))) as Vec3;
  const indices = Array.from({ length: out.positions.length / 3 }, (_, i) => i);
  const body: LayerBody = {
    bodyId: ghosts[0]!.body.bodyId,
    name: feature.name,
    meshKey: `extrude ${feature.id} ${ends} ${sections.map((c) => c.key)}`,
    ...out,
    indices,
    faces: [],
    edges: [],
    vertices: [],
    bbox: {
      min: corner((b) => b.min, Math.min),
      max: corner((b) => b.max, Math.max),
    },
  };
  return [{ body, tint, ranges: [{ start: 0, count: indices.length }] }];
}
