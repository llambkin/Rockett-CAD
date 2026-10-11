import type { PlaneFrame } from "./api.js";
import { uncovered, type Profile } from "./profiles.js";
import { UNIT_DOT_TOL } from "./tolerance.js";

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((v, x, i) => v + x * b[i]!, 0);

export function faceRegions<
  S extends { frame: PlaneFrame; profiles: Profile[] },
>(
  face: PlaneFrame,
  sketches: Iterable<S>,
  inFace: (u: number, v: number) => boolean,
): { sketch: S; profile: Profile; outline: number[] }[] {
  const found = [...sketches].flatMap((sketch) => {
    const { origin, xAxis, yAxis, normal } = sketch.frame;
    const lift = (u: number, v: number) =>
      origin.map((o, i) => o + u * xAxis[i]! + v * yAxis[i]! - face.origin[i]!);
    if (
      Math.abs(dot(normal, face.normal)) < 1 - UNIT_DOT_TOL ||
      Math.abs(dot(lift(0, 0), face.normal)) > 1e-5
    )
      return [];
    return sketch.profiles.flatMap((profile) => {
      const outline = profile.polygon.flatMap((u, i, p) => {
        if (i % 2) return [];
        const w = lift(u, p[i + 1]!);
        return [dot(w, face.xAxis), dot(w, face.yAxis)];
      });
      const step = 2 * Math.max(1, Math.ceil(outline.length / 96));
      const inside = outline.every(
        (u, i) => i % step || inFace(u, outline[i + 1]!),
      );
      return profile.area > 1e-9 && inside
        ? [{ sketch, profile, outline }]
        : [];
    });
  });
  const kept = new Set(uncovered(found.map((r) => r.outline)));
  return found.filter((r) => kept.has(r.outline));
}
