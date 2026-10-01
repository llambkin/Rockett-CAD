import { ShapeUtils, Vector2 } from "three";
import { extrudeOverlapsSolid } from "./extrudeOverlap";
import {
  findProfile,
  LINEAR_TOL,
  pointInPolygon,
  UNIT_DOT_TOL,
  type BodyPayload,
  type FaceInfo,
  type PlaneFrame,
  type SketchPayload,
  type Vec3,
} from "@rockett/shared";
import type { PreviewGhost } from "./livePreview";
import { previewBodies, previewedFeature, useStore } from "./store";

interface Base {
  points: Vec3[];
  triangles?: Vec3[][];
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
    points: framePoints(sketch.frame, profile.polygon),
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
  const body = bodies.find((b) => b.bodyId === sel.bodyId);
  const face = body?.faces.find((f) => f.name === sel.faceName);
  if (!body || !face || face.surface.type !== "plane") return null;
  const points: Vec3[] = [];
  for (let i = face.start; i < face.start + face.count; i++) {
    const at = body.indices[i]! * 3;
    points.push([
      body.positions[at]!,
      body.positions[at + 1]!,
      body.positions[at + 2]!,
    ]);
  }
  return { points, normal: face.surface.normal };
}

function swept({ points, normal }: Base, from: number, to: number): Bounds {
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

function overlaps(a: Bounds, b: Bounds, margin: number): boolean {
  for (let i = 0; i < 3; i++)
    if (a.max[i]! <= b.min[i]! + margin || b.max[i]! <= a.min[i]! + margin)
      return false;
  return true;
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

export function toolOperation(tools?: Bounds[]): ToolOperation {
  const bodies = previewBodies(useStore.getState());
  return bodies.some(
    (b) => !tools || tools.some((t) => overlaps(t, b.bbox, -LINEAR_TOL)),
  )
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
  const s = useStore.getState();
  const bodies = previewBodies(s);
  const tools = s.selection.flatMap((sel) => {
    const base =
      sel.kind === "profile"
        ? profileBase(sel, s.evaluation?.sketches ?? [])
        : sel.kind === "face"
          ? faceBase(sel, bodies)
          : null;
    return base ? [{ base, bounds: swept(base, from, to) }] : [];
  });
  if (
    into &&
    tools.some(({ base, bounds }) =>
      bodies.some(
        (body) =>
          overlaps(bounds, body.bbox, LINEAR_TOL) &&
          extrudeOverlapsSolid(
            base.triangles ??
              Array.from({ length: base.points.length / 3 }, (_, i) =>
                base.points.slice(i * 3, i * 3 + 3),
              ),
            base.normal,
            [from, to],
            body,
            bounds,
          ),
      ),
    )
  )
    return "cut";
  return toolOperation(tools.map((tool) => tool.bounds));
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

function faceLoops(body: BodyPayload, face: FaceInfo, normal: Vec3) {
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

function sketchRegions(
  rings: Vector2[][],
  normal: Vec3,
  depth: number,
  sketches: SketchPayload[],
  flat: (p: Vec3) => Vector2,
): Vector2[][] {
  const polygons = rings.map(flatten);
  const inside = (q: Vector2) =>
    polygons.filter((p) => pointInPolygon(q.x, q.y, p)).length % 2 === 1 &&
    rings.every((r) =>
      r.every((a, k) => gap(q, a, r[(k + 1) % r.length]!) > LINEAR_TOL),
    );
  const found = sketches.flatMap(({ frame, profiles }) =>
    Math.abs(dot(frame.normal, normal)) < 1 - UNIT_DOT_TOL ||
    Math.abs(dot(frame.origin, normal) - depth) > 1e-5
      ? []
      : profiles.flatMap((p) => {
          const ring = framePoints(frame, p.polygon).map(flat);
          const step = Math.max(1, Math.ceil(ring.length / 48));
          return p.area > 1e-9 &&
            ring.every((q, i) => i % step > 0 || inside(q))
            ? [ring]
            : [];
        }),
  );
  return found.filter(
    (r, i) =>
      !found.some(
        (o, j) => j !== i && pointInPolygon(r[0]!.x, r[0]!.y, flatten(o)),
      ),
  );
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
    where.get(q)!.map((v, i) => v + normal[i]! * t) as Vec3;
  const rings = loops
    .map((l) => l.map(flat))
    .toSorted(
      (a, b) => Math.abs(ShapeUtils.area(b)) - Math.abs(ShapeUtils.area(a)),
    );
  const [outer, ...holes] = [
    ...rings,
    ...sketchRegions(rings, normal, depth, sketches, flat),
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
      const face = body?.faces.find((f) => f.name === ref.faceName);
      if (!body || face?.surface.type !== "plane") return undefined;
      return {
        key: `${body.meshKey} ${face.name}`,
        loops: faceLoops(body, face, face.surface.normal),
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
  const body: BodyPayload = {
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
