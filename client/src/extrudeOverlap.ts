import { Plane, Ray, Vector3 } from "three";
import { LINEAR_TOL, type BodyPayload, type Vec3 } from "@rockett/shared";

function triangleInPrism(polygon: Vector3[], planes: Plane[]): boolean {
  for (const plane of planes) {
    const clipped: Vector3[] = [];
    for (const [j, a] of polygon.entries()) {
      const b = polygon[(j + 1) % polygon.length]!;
      const da = plane.distanceToPoint(a);
      const db = plane.distanceToPoint(b);
      if (da >= 0) clipped.push(a);
      if (da < 0 !== db < 0) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = clipped;
    if (!polygon.length) break;
  }
  return polygon.length > 0;
}

function prismPlanes(low: Vector3[], high: Vector3[], center: Vector3) {
  const planes = [
    new Plane().setFromCoplanarPoints(...(low as [Vector3, Vector3, Vector3])),
    new Plane().setFromCoplanarPoints(...(high as [Vector3, Vector3, Vector3])),
    ...low.map((p, i) =>
      new Plane().setFromCoplanarPoints(p, low[(i + 1) % 3]!, high[i]!),
    ),
  ];
  for (const plane of planes) {
    if (plane.distanceToPoint(center) < 0) plane.negate();
    plane.constant -= LINEAR_TOL;
  }
  return planes;
}

export function extrudeOverlapsSolid(
  triangles: Vec3[][],
  direction: Vec3,
  [from, to]: [number, number],
  body: BodyPayload,
  bounds: BodyPayload["bbox"],
): boolean {
  const normal = new Vector3(...direction);
  for (const tri of triangles) {
    const low = tri.map((p) =>
      new Vector3(...p).addScaledVector(normal, Math.min(from, to)),
    );
    const high = low.map((p) =>
      p.clone().addScaledVector(normal, Math.abs(to - from)),
    );
    const center = [...low, ...high]
      .reduce((p, q) => p.add(q), new Vector3())
      .multiplyScalar(1 / 6);
    const planes = prismPlanes(low, high, center);
    const ray = new Ray(center, new Vector3(1, 0.371, 0.529).normalize());
    const hits: { distance: number; facing: number }[] = [];
    const vertices = [new Vector3(), new Vector3(), new Vector3()];
    const target = new Vector3();
    const edge = new Vector3();
    const side = new Vector3();
    for (let i = 0; i + 2 < body.indices.length; i += 3) {
      let clips = true;
      let crosses = true;
      for (let axis = 0; axis < 3 && (clips || crosses); axis++) {
        const a = body.positions[body.indices[i]! * 3 + axis]!;
        const b = body.positions[body.indices[i + 1]! * 3 + axis]!;
        const c = body.positions[body.indices[i + 2]! * 3 + axis]!;
        const min = Math.min(a, b, c);
        const max = Math.max(a, b, c);
        clips &&= max > bounds.min[axis]! && min < bounds.max[axis]!;
        crosses &&= max >= center.getComponent(axis);
      }
      if (!clips && !crosses) continue;
      vertices.forEach((v, j) =>
        v.fromArray(body.positions, body.indices[i + j]! * 3),
      );
      if (
        crosses &&
        ray.intersectTriangle(
          vertices[0]!,
          vertices[1]!,
          vertices[2]!,
          false,
          target,
        )
      ) {
        const facing = Math.sign(
          edge
            .subVectors(vertices[1]!, vertices[0]!)
            .cross(side.subVectors(vertices[2]!, vertices[0]!))
            .dot(ray.direction),
        );
        hits.push({ distance: center.distanceTo(target), facing });
      }
      if (!clips) continue;
      if (triangleInPrism(vertices, planes)) return true;
    }
    hits.sort((a, b) => a.distance - b.distance);
    const crossings = hits.filter((hit, i) => {
      const prior = hits[i - 1];
      return (
        !prior ||
        hit.facing !== prior.facing ||
        Math.abs(hit.distance - prior.distance) >
          Number.EPSILON * Math.max(1, hit.distance) * 8
      );
    });
    if (crossings.reduce((total, hit) => total + hit.facing, 0) !== 0)
      return true;
  }
  return false;
}
