import { featureUI, type SharedInputParams } from "../features/registry";
import * as THREE from "three";
import type {
  BodyPayload,
  EvaluateResult,
  FaceInfo,
  MeshPayload,
  PlaneFrame,
  Profile,
  SketchPayload,
} from "@rockett/shared";
import { findProfile } from "@rockett/shared";
import type { Selection } from "../store";
import { meshOf } from "./meshes";
import { ORIGIN_PLANE_DEFS } from "./CadViewport";

export type NumericParam<P> = {
  [K in keyof P]-?: number extends NonNullable<P[K]> ? K : never;
}[keyof P] &
  string;

export interface FeatureHandleDefinition<P> {
  param: NumericParam<P>;
  fallback: number;
  signed?: boolean;
  place?: (input: HandleInput<P>) => Placement | null;
}

interface Ray {
  origin: THREE.Vector3;
  axis: THREE.Vector3;
}

type Placement =
  ({ kind: "arrow" } & Ray) | { kind: "arc"; through: THREE.Vector3 };

export const arrow = (ray: Ray | null): Placement | null =>
  ray && { kind: "arrow", ...ray };

export const first = (input: HandleInput, kind: Selection["kind"]) =>
  input.selection.find((s) => s.kind === kind);

export type FeatureHandle = {
  param: string;
  value: number;
  signed: boolean;
} & Placement;

export interface HandleInput<P = SharedInputParams> {
  dialog: string;
  params: P;
  selection: Selection[];
  bodies: BodyPayload[];
  evaluation: EvaluateResult | null;
}

export function profileCentroid(profile: Profile): [number, number] {
  let u = 0;
  let v = 0;
  const n = profile.polygon.length / 2;
  for (let i = 0; i + 1 < profile.polygon.length; i += 2) {
    u += profile.polygon[i]!;
    v += profile.polygon[i + 1]!;
  }
  return [u / (n || 1), v / (n || 1)];
}

function vertex(body: MeshPayload, at: number, from = body.positions) {
  return new THREE.Vector3(from[at * 3], from[at * 3 + 1], from[at * 3 + 2]);
}

export function faceCentroid(
  body: MeshPayload,
  face: FaceInfo,
): THREE.Vector3 | null {
  const seen = new Set<number>();
  const sum = new THREE.Vector3();
  for (let i = face.start; i < face.start + face.count; i++) {
    const vi = body.indices[i];
    if (vi === undefined || vi * 3 + 2 >= body.positions.length) return null;
    if (seen.has(vi)) continue;
    seen.add(vi);
    sum.add(vertex(body, vi));
  }
  return seen.size > 0 ? sum.divideScalar(seen.size) : null;
}

export function frameAlong(
  origin: THREE.Vector3,
  normal: THREE.Vector3,
): PlaneFrame {
  const n = normal.clone().normalize();
  const seed =
    Math.abs(n.x) > 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const x = seed.addScaledVector(n, -n.dot(seed)).normalize();
  const y = n.clone().cross(x).normalize();
  return {
    origin: [origin.x, origin.y, origin.z],
    xAxis: [x.x, x.y, x.z],
    yAxis: [y.x, y.y, y.z],
    normal: [n.x, n.y, n.z],
  };
}

function faceNormal(body: MeshPayload, face: FaceInfo): THREE.Vector3 | null {
  if (face.surface.type === "plane")
    return new THREE.Vector3(...face.surface.normal).normalize();
  const sum = new THREE.Vector3();
  for (let i = face.start; i < face.start + face.count; i++)
    sum.add(vertex(body, body.indices[i]!, body.normals));
  return sum.lengthSq() > 1e-12 ? sum.normalize() : null;
}

export function faceRay(
  bodies: BodyPayload[],
  sel: Selection | undefined,
): Ray | null {
  if (sel?.kind !== "face") return null;
  const found = bodies.find((b) => b.bodyId === sel.bodyId);
  const body = found && meshOf(found);
  const face = body?.faces.find((f) => f.name === sel.faceName);
  if (!body || !face) return null;
  const origin = faceCentroid(body, face);
  const axis = faceNormal(body, face);
  return origin && axis ? { origin, axis } : null;
}

export function edgeRay(
  bodies: BodyPayload[],
  sel: Selection | undefined,
): Ray | null {
  if (sel?.kind !== "edge") return null;
  const found = bodies.find((b) => b.bodyId === sel.bodyId);
  const body = found && meshOf(found);
  const pl = body?.edges.find((e) => e.name === sel.edgeName)?.polyline;
  if (!found || !body || !pl || pl.length < 6) return null;
  const n = pl.length / 3;
  const i = Math.floor((n - 1) / 2);
  const mid = new THREE.Vector3(pl[i * 3], pl[i * 3 + 1], pl[i * 3 + 2])
    .add(
      new THREE.Vector3(
        pl[(n - 1 - i) * 3],
        pl[(n - 1 - i) * 3 + 1],
        pl[(n - 1 - i) * 3 + 2],
      ),
    )
    .multiplyScalar(0.5);
  const size = new THREE.Vector3(...found.bbox.max).distanceTo(
    new THREE.Vector3(...found.bbox.min),
  );
  const tolerance = 1e-6 + size * 1e-4;
  const axis = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  const closest = new THREE.Vector3();
  for (const face of body.faces) {
    for (let t = face.start; t + 2 < face.start + face.count; t += 3) {
      const [a, b, c] = [t, t + 1, t + 2].map((k) => body.indices[k]!) as [
        number,
        number,
        number,
      ];
      triangle.set(vertex(body, a), vertex(body, b), vertex(body, c));
      triangle.closestPointToPoint(mid, closest);
      if (closest.distanceTo(mid) > tolerance) continue;
      axis.add(
        vertex(body, a, body.normals)
          .add(vertex(body, b, body.normals))
          .add(vertex(body, c, body.normals))
          .normalize(),
      );
      break;
    }
  }
  return axis.lengthSq() > 1e-12
    ? { origin: mid, axis: axis.normalize() }
    : null;
}

export function sketchOf(
  evaluation: EvaluateResult | null,
  sel: Selection | undefined,
): { sketch: SketchPayload; profile: Profile } | null {
  if (sel?.kind !== "profile") return null;
  const sketch = evaluation?.sketches.find((s) => s.featureId === sel.sketchId);
  const profile = sketch && findProfile(sketch, sel.profileId);
  return sketch && profile ? { sketch, profile } : null;
}

export function planeRay(input: HandleInput): Ray | null {
  const { selection, evaluation, bodies } = input;
  const plane = selection.find((s) => s.kind === "plane");
  if (!plane)
    return faceRay(
      bodies,
      selection.find((s) => s.kind === "face"),
    );
  const ref = plane.ref;
  if (ref.kind === "face") return faceRay(bodies, ref.face);
  const frame =
    ref.kind === "origin"
      ? ORIGIN_PLANE_DEFS.find((d) => d.name === ref.plane)?.frame
      : evaluation?.planes.find((p) => p.featureId === ref.featureId)?.frame;
  return frame
    ? {
        origin: new THREE.Vector3(...frame.origin),
        axis: new THREE.Vector3(...frame.normal),
      }
    : null;
}

export function bodyCenter(input: HandleInput): THREE.Vector3 | null {
  const sel = input.selection.find((s) => s.kind === "body");
  const body = input.bodies.find(
    (b) => sel?.kind === "body" && b.bodyId === sel.bodyId,
  );
  return body
    ? new THREE.Vector3(...body.bbox.min)
        .add(new THREE.Vector3(...body.bbox.max))
        .multiplyScalar(0.5)
    : null;
}

export function featureHandle<P extends SharedInputParams>(
  input: HandleInput<P>,
): FeatureHandle | null {
  const ui = featureUI(input.dialog);
  if (!ui?.handle) return null;
  return ui.create(input.params).handle(input);
}
