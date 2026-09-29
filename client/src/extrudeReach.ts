import {
  findProfile,
  LINEAR_TOL,
  type BodyPayload,
  type FaceInfo,
  type SketchPayload,
  type Vec3,
} from "@rockett/shared";
import type { PreviewGhost } from "./livePreview";
import { previewBodies, previewedFeature, useStore } from "./store";

interface Base {
  points: Vec3[];
  normal: Vec3;
}

interface Bounds {
  min: Vec3;
  max: Vec3;
}

function profileBase(
  sel: { sketchId: string; profileId: string },
  sketches: SketchPayload[],
): Base | null {
  const sketch = sketches.find((s) => s.featureId === sel.sketchId);
  const profile = sketch && findProfile(sketch, sel.profileId);
  if (!sketch || !profile) return null;
  const { origin: o, xAxis: x, yAxis: y, normal } = sketch.frame;
  const points: Vec3[] = [];
  for (let i = 0; i + 1 < profile.polygon.length; i += 2) {
    const u = profile.polygon[i]!;
    const v = profile.polygon[i + 1]!;
    points.push([
      o[0] + u * x[0] + v * y[0],
      o[1] + u * x[1] + v * y[1],
      o[2] + u * x[2] + v * y[2],
    ]);
  }
  return { points, normal };
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

export function toolOperation(tools?: Bounds[], into = false): ToolOperation {
  const bodies = previewBodies(useStore.getState());
  const meets = (margin: number) =>
    bodies.length > 0 &&
    (!tools ||
      tools.some((t) => bodies.some((b) => overlaps(t, b.bbox, margin))));
  if (into && meets(LINEAR_TOL)) return "cut";
  return meets(-LINEAR_TOL) ? "join" : "newBody";
}

export function autoOperation(
  params: { operation?: string; autoOperation?: boolean },
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
    return base ? [swept(base, from, to)] : [];
  });
  return toolOperation(tools, into);
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

function prism(
  body: BodyPayload,
  face: FaceInfo,
  normal: Vec3,
  [low, high]: number[],
  out: Mesh,
) {
  const at = (v: number, t = 0): Vec3 => [
    body.positions[v * 3]! + normal[0] * t,
    body.positions[v * 3 + 1]! + normal[1] * t,
    body.positions[v * 3 + 2]! + normal[2] * t,
  ];
  const open = new Map<string, [number, number]>();
  for (let i = face.start; i + 2 < face.start + face.count; i += 3) {
    const tri = body.indices.slice(i, i + 3);
    const n = across(tri.map((v) => at(v)));
    if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0)
      tri.reverse();
    triangle(
      out,
      tri.map((v) => at(v, high)),
    );
    triangle(
      out,
      tri.toReversed().map((v) => at(v, low)),
    );
    for (const [k, u] of tri.entries()) {
      const w = tri[(k + 1) % 3]!;
      if (!open.delete(`${at(w)} ${at(u)}`))
        open.set(`${at(u)} ${at(w)}`, [u, w]);
    }
  }
  for (const [u, w] of open.values()) {
    triangle(out, [at(u, low), at(w, low), at(w, high)]);
    triangle(out, [at(u, low), at(w, high), at(u, high)]);
  }
}

export function extrudeGhosts(ghosts: PreviewGhost[]): PreviewGhost[] {
  const s = useStore.getState();
  const feature = previewedFeature(s);
  const bodies = previewBodies(s);
  const tint = ghosts[0]?.tint;
  if (
    !tint ||
    feature?.type !== "extrude" ||
    feature.profiles.length > 0 ||
    !feature.faces?.length ||
    feature.operation === "intersect"
  )
    return ghosts;
  const ends = span(
    feature.direction,
    feature.distance,
    feature.startOffset ?? 0,
    feature.distance2 ?? 0,
  ).toSorted((a, b) => a - b);
  const out: Mesh = { positions: [], normals: [] };
  const keys: string[] = [];
  for (const ref of feature.faces) {
    const body = bodies.find((b) => b.bodyId === ref.bodyId);
    const face = body?.faces.find((f) => f.name === ref.faceName);
    if (!body || !face || face.surface.type !== "plane") return ghosts;
    keys.push(body.meshKey, face.name);
    prism(body, face, face.surface.normal, ends, out);
  }
  const boxes = feature.faces.map((ref) =>
    swept(faceBase(ref, bodies)!, ends[0]!, ends[1]!),
  );
  const corner = (pick: (b: Bounds) => Vec3, f: typeof Math.min) =>
    [0, 1, 2].map((i) => f(...boxes.map((b) => pick(b)[i]!))) as Vec3;
  const indices = Array.from({ length: out.positions.length / 3 }, (_, i) => i);
  const body: BodyPayload = {
    bodyId: feature.faces[0]!.bodyId,
    name: feature.name,
    meshKey: `extrude ${feature.id} ${ends} ${keys}`,
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
