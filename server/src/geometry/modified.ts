import { compareNames, LINEAR_TOL, type Vec3 } from "@rockett/shared";
import { areaOf, faceCentroid, faces, scoped, type Shape } from "./kernel.js";
import { V } from "./frames.js";
import type { StateBody } from "./features.js";
import { namesOf } from "./meshBody.js";

interface Measure {
  area: number;
  centre: Vec3;
}

interface Prior {
  face: Shape;
  measure?: Measure;
}

const base = (name: string) => name.replace(/(?:~\??\d+)+$/, "");

const bases = (body: StateBody) => new Set([...namesOf(body)].map(base));

const shares = (body: StateBody, keys: ReadonlySet<string>) =>
  [...bases(body)].some((key) => keys.has(key));

const measure = (face: Shape): Measure => ({
  area: areaOf(face),
  centre: faceCentroid(face),
});

const sameGeometry = (a: Measure, b: Measure) =>
  V.norm(V.sub(a.centre, b.centre)) <= LINEAR_TOL &&
  Math.abs(a.area - b.area) <= LINEAR_TOL * Math.max(1, a.area);

function unchanged(face: Shape, priors: Prior[]): boolean {
  let mine: Measure | undefined;
  return priors.some(
    (p) =>
      p.face.IsSame(face) ||
      sameGeometry((p.measure ??= measure(p.face)), (mine ??= measure(face))),
  );
}

export function modifiedFaces(
  before: ReadonlyMap<string, StateBody>,
  after: ReadonlyMap<string, StateBody>,
): Record<string, string[]> | undefined {
  return scoped(() => {
    const changed = [...after.values()].filter(
      (b) => before.get(b.bodyId) !== b,
    );
    if (changed.length === 0) return;
    const carried = new Set([...before.values()].flatMap((b) => [...bases(b)]));
    const candidates = changed.filter((b) => shares(b, carried));
    if (candidates.length === 0) return;
    const wanted = new Set(candidates.flatMap((b) => [...bases(b)]));
    const priors = new Map<string, Prior[]>();
    const out: Record<string, string[]> = {};

    for (const body of [...before.values()].filter((b) => shares(b, wanted)))
      for (const face of faces(body.shape)) {
        const name = body.names.get(face);
        if (name)
          priors.set(base(name), [...(priors.get(base(name)) ?? []), { face }]);
      }
    for (const body of candidates) {
      const names: string[] = [];
      for (const face of faces(body.shape)) {
        const name = body.names.get(face);
        if (
          name &&
          carried.has(base(name)) &&
          !unchanged(face, priors.get(base(name)) ?? [])
        )
          names.push(name);
      }
      if (names.length > 0) out[body.bodyId] = names.toSorted(compareNames);
    }

    return Object.keys(out).length > 0 ? out : undefined;
  });
}
