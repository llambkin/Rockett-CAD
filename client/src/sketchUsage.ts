/**
 * Which sketch regions existing features already use. Drives the faint
 * shading of used regions and the "free regions" preselection when a sketch is
 * extruded from the tree.
 */

import type { CadDocument } from "@rockett/shared";

export interface SketchUsage {
  /** `${sketchId}:${profileId}` of every region referenced by a feature */
  profiles: Set<string>;
  /** sketches used whole (sweep paths, loft sections without a region id) */
  sketches: Set<string>;
}

export const profileKey = (sketchId: string, profileId: string) =>
  `${sketchId}:${profileId}`;

export function sketchUsage(document: CadDocument): SketchUsage {
  const profiles = new Set<string>();
  const sketches = new Set<string>();
  for (const f of document.features) {
    const anyF = f as any;
    for (const p of anyF.profiles ?? []) profiles.add(profileKey(p.sketchId, p.profileId));
    for (const p of anyF.sections ?? []) {
      if (p.profileId) profiles.add(profileKey(p.sketchId, p.profileId));
      else sketches.add(p.sketchId);
    }
    if (anyF.pathSketchId) sketches.add(anyF.pathSketchId);
  }
  return { profiles, sketches };
}

export function isProfileUsed(usage: SketchUsage, sketchId: string, profileId: string): boolean {
  return usage.sketches.has(sketchId) || usage.profiles.has(profileKey(sketchId, profileId));
}

/** Region ids of a sketch no feature has used yet. */
export function freeProfileIds(
  usage: SketchUsage,
  sketchId: string,
  profiles: { id: string }[]
): string[] {
  return profiles.filter((p) => !isProfileUsed(usage, sketchId, p.id)).map((p) => p.id);
}
