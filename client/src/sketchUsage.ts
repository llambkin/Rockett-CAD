/**
 * Which sketch regions existing features already use. Drives the faint
 * shading of used regions and the "free regions" preselection when a sketch is
 * extruded from the tree.
 */

import {
  featureRefs,
  findProfile,
  pointInPolygon,
  type CadDocument,
  type Profile,
  type SketchPayload,
} from "@rockett/shared";

type Sketch = Pick<SketchPayload, "featureId" | "entities" | "profiles">;

export interface SketchUsage {
  /** `${sketchId}:${profileId}` of every region referenced by a feature */
  profiles: Set<string>;
  /** sketches used whole (sweep paths, loft sections without a region id) */
  sketches: Set<string>;
}

const profileKey = (sketchId: string, profileId: string) =>
  `${sketchId}:${profileId}`;

const inside = (x: number, y: number, p: Profile) =>
  pointInPolygon(x, y, p.polygon) &&
  !p.holePolygons.some((h) => pointInPolygon(x, y, h));

function interior(p: Profile): [number, number] {
  const v = p.polygon;
  const n = v.length / 2;
  let i = 0;
  const length = (k: number) =>
    Math.hypot(
      v[((k + 1) % n) * 2]! - v[k * 2]!,
      v[((k + 1) % n) * 2 + 1]! - v[k * 2 + 1]!,
    );
  for (let k = 1; k < n; k++) if (length(k) > length(i)) i = k;
  const [x0, y0] = [v[i * 2]!, v[i * 2 + 1]!];
  const [x1, y1] = [v[((i + 1) % n) * 2]!, v[((i + 1) % n) * 2 + 1]!];
  const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const [nx, ny] = [(y0 - y1) * 1e-3, (x1 - x0) * 1e-3];
  return inside(mx + nx, my + ny, p) ? [mx + nx, my + ny] : [mx - nx, my - ny];
}

export function savedRegionIds(sketch: Sketch, profileId: string): string[] {
  const saved = findProfile(sketch, profileId);
  if (!saved) return [];
  if (sketch.profiles.includes(saved)) return [saved.id];
  return sketch.profiles
    .filter((p) => inside(...interior(p), saved))
    .map((p) => p.id);
}

export function sketchUsage(
  document: CadDocument,
  evaluated: readonly Sketch[] = [],
): SketchUsage {
  const profiles = new Set<string>();
  const sketches = new Set<string>();
  for (const f of document.features)
    for (const ref of featureRefs(f)) {
      if (ref.kind === "sketch") sketches.add(ref.sketch);
      if (ref.kind !== "profile") continue;
      const { sketchId, profileId } = ref.profile;
      const sketch = evaluated.find((s) => s.featureId === sketchId);
      for (const id of sketch ? savedRegionIds(sketch, profileId) : [profileId])
        profiles.add(profileKey(sketchId, id));
    }
  return { profiles, sketches };
}

export function isProfileUsed(
  usage: SketchUsage,
  sketchId: string,
  profileId: string,
): boolean {
  return (
    usage.sketches.has(sketchId) ||
    usage.profiles.has(profileKey(sketchId, profileId))
  );
}

/** Region ids of a sketch no feature has used yet. */
export function freeProfileIds(
  usage: SketchUsage,
  sketchId: string,
  profiles: { id: string }[],
): string[] {
  return profiles
    .filter((p) => !isProfileUsed(usage, sketchId, p.id))
    .map((p) => p.id);
}
