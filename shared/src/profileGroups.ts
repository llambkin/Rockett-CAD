import type { Profile } from "./profiles.js";

function boundaryKeys(sketchId: string, profile: Profile): string[] {
  const end = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
  return [profile.outer, ...profile.holes].flat().map((c) => {
    if (!c.trim) return `${sketchId}/${c.entityId}`;
    const [sx, sy, ex, ey] = c.trim;
    const ends = [end(sx, sy), end(ex, ey)].sort().join("|");
    return `${sketchId}/${c.entityId}/${ends}`;
  });
}

export function touchingProfileGroups(
  regions: { sketchId: string; profile: Profile }[],
): number[][] {
  const parent = regions.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]!));
  const owner = new Map<string, number>();
  regions.forEach(({ sketchId, profile }, i) => {
    for (const key of boundaryKeys(sketchId, profile)) {
      const other = owner.get(key);
      if (other === undefined) owner.set(key, i);
      else
        parent[Math.max(root(i), root(other))] = Math.min(root(i), root(other));
    }
  });
  const groups = new Map<number, number[]>();
  regions.forEach((_, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()];
}
