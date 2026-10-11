import { refsAt, registerCoreSpec } from "../featureSpec.js";
import type { FilletFeature, FilletSet } from "../model.js";

export const filletSets = (f: FilletFeature): FilletSet[] => [
  {
    edges: f.edges,
    ...(f.faces && { faces: f.faces }),
    ...(f.features && { features: f.features }),
    ...(f.betweenFaces && { betweenFaces: f.betweenFaces }),
    ...(f.betweenFeatures && { betweenFeatures: f.betweenFeatures }),
    radius: f.radius,
  },
  ...(f.sets ?? []),
];

export function withFilletSets<F extends FilletFeature>(
  f: F,
  [first, ...more]: [FilletSet, ...FilletSet[]],
): F {
  const {
    faces: _faces,
    features: _features,
    betweenFaces: _betweenFaces,
    betweenFeatures: _betweenFeatures,
    sets: _sets,
    ...rest
  } = f;
  return { ...rest, ...first, ...(more.length > 0 && { sets: more }) } as F;
}

registerCoreSpec("fillet", "Fillet", (f) =>
  filletSets(f).flatMap((set, i) => {
    const at = i === 0 ? "" : `/sets/${i - 1}`;
    return [
      ...refsAt("edge", `${at}/edges`, set.edges),
      ...refsAt("face", `${at}/faces`, set.faces),
      ...refsAt("feature", `${at}/features`, set.features),
      ...refsAt("face", `${at}/betweenFaces`, set.betweenFaces),
      ...refsAt("feature", `${at}/betweenFeatures`, set.betweenFeatures),
    ];
  }),
);
