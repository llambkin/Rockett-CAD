import {
  createEmptyDocument,
  type BodyPayload,
  type CadDocument,
  type EdgeInfo,
  type EvaluateResult,
  type FaceInfo,
  type PlaneFrame,
  type ReferenceImageFeature,
  type SketchEntity,
  type Vec3,
} from "@rockett/shared";
import type { SketchRenderInput } from "../../src/three/sketchRender";

const STAMP = "2026-01-01T00:00:00.000Z";
const BOX: Vec3 = [10, 10, 5];
const BODY_SPACING = 15;
const DIVISIONS = 13;
const SQUARE_PITCH = 10;
const SQUARE_SIDE = 6;
export const IMAGE_PIXELS = 4096;
const IMAGE_PITCH = 50;

const XY: PlaneFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

const SIDES: { origin: Vec3; u: Vec3; v: Vec3; normal: Vec3 }[] = [
  { origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0], normal: [0, 0, -1] },
  { origin: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] },
  { origin: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], normal: [0, 1, 0] },
  { origin: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], normal: [-1, 0, 0] },
  { origin: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] },
];

const CORNERS: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
  i & 1,
  (i >> 1) & 1,
  (i >> 2) & 1,
]);

const box = (at: Vec3, unit: Vec3): Vec3 => [
  at[0] + unit[0] * BOX[0],
  at[1] + unit[1] * BOX[1],
  at[2] + unit[2] * BOX[2],
];

function boxBody(bodyId: string, at: Vec3): BodyPayload {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: FaceInfo[] = SIDES.map((side, k) => {
    const base = positions.length / 3;
    for (let j = 0; j <= DIVISIONS; j++)
      for (let i = 0; i <= DIVISIONS; i++) {
        const s = i / DIVISIONS;
        const t = j / DIVISIONS;
        positions.push(
          ...box(at, [
            side.origin[0] + s * side.u[0] + t * side.v[0],
            side.origin[1] + s * side.u[1] + t * side.v[1],
            side.origin[2] + s * side.u[2] + t * side.v[2],
          ]),
        );
        normals.push(...side.normal);
      }
    const start = indices.length;
    for (let j = 0; j < DIVISIONS; j++)
      for (let i = 0; i < DIVISIONS; i++) {
        const a = base + j * (DIVISIONS + 1) + i;
        const c = a + DIVISIONS + 1;
        indices.push(a, a + 1, c + 1, a, c + 1, c);
      }
    return {
      name: `f:${bodyId}:${k}`,
      start,
      count: indices.length - start,
      surface: {
        type: "plane",
        origin: box(at, side.origin),
        normal: side.normal,
      },
      area: 0,
    };
  });
  const edges: EdgeInfo[] = [];
  CORNERS.forEach((from, i) => {
    for (const axis of [0, 1, 2] as const) {
      if (from[axis] === 1) continue;
      const to: Vec3 = [...from];
      to[axis] = 1;
      const a = box(at, from);
      const b = box(at, to);
      const polyline: number[] = [];
      for (let n = 0; n <= DIVISIONS; n++) {
        const s = n / DIVISIONS;
        polyline.push(
          a[0] + s * (b[0] - a[0]),
          a[1] + s * (b[1] - a[1]),
          a[2] + s * (b[2] - a[2]),
        );
      }
      edges.push({
        name: `e:${bodyId}:${i}:${axis}`,
        polyline,
        length: BOX[axis],
        curve: { type: "line", a, b },
      });
    }
  });
  return {
    bodyId,
    name: bodyId,
    visible: true,
    meshKey: `box:${at.join(",")}`,
    positions,
    normals,
    indices,
    faces,
    edges,
    vertices: CORNERS.map((c, i) => ({
      name: `v:${bodyId}:${i}`,
      position: box(at, c),
    })),
    bbox: { min: at, max: box(at, [1, 1, 1]) },
  };
}

export function manyBodyPayloads(columns = 25, rows = 40): BodyPayload[] {
  const bodies: BodyPayload[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++)
      bodies.push(
        boxBody(`b:${x}:${y}`, [x * BODY_SPACING, y * BODY_SPACING, 0]),
      );
  return bodies;
}

export function squareSketch(columns = 25, rows = 10): SketchRenderInput {
  const entities: SketchEntity[] = [];
  for (let k = 0; k < columns * rows; k++) {
    const x = (k % columns) * SQUARE_PITCH;
    const y = Math.floor(k / columns) * SQUARE_PITCH;
    const corners: [number, number][] = [
      [x, y],
      [x + SQUARE_SIDE, y],
      [x + SQUARE_SIDE, y + SQUARE_SIDE],
      [x, y + SQUARE_SIDE],
    ];
    corners.forEach(([px, py], i) =>
      entities.push({ id: `sq${k}-p${i}`, kind: "point", x: px, y: py }),
    );
    corners.forEach((_, i) =>
      entities.push({
        id: `sq${k}-l${i}`,
        kind: "line",
        p1: `sq${k}-p${i}`,
        p2: `sq${k}-p${(i + 1) % 4}`,
      }),
    );
  }
  return {
    sketchId: "perf-sketch",
    frame: XY,
    entities,
    showProfiles: true,
    active: true,
  };
}

export function imageScene(
  id: string,
  count = 50,
): { doc: CadDocument; evaluation: EvaluateResult } {
  const features: ReferenceImageFeature[] = Array.from(
    { length: count },
    (_, k) => ({
      id: `img${k}`,
      name: `img${k}`,
      suppressed: false,
      type: "referenceImage",
      plane: { kind: "origin", plane: "XY" },
      assetId: `asset${k}`,
      fileName: `asset${k}.png`,
      transform: { u: k * IMAGE_PITCH, v: 0, rotation: 0, scale: 0.01 },
      opacity: 0.5,
      visible: true,
      width: IMAGE_PIXELS,
      height: IMAGE_PIXELS,
    }),
  );
  const doc: CadDocument = {
    ...createEmptyDocument(id, id),
    createdAt: STAMP,
    modifiedAt: STAMP,
    features,
    timelinePosition: features.length,
  };
  const evaluation: EvaluateResult = {
    bodies: [],
    featureStatuses: features.map((f) => ({ featureId: f.id, status: "ok" })),
    sketches: [],
    planes: features.map((f) => ({ featureId: f.id, frame: XY, size: 0 })),
    kernelMs: 0,
  };
  return { doc, evaluation };
}
