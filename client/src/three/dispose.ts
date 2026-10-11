import type * as THREE from "three";

export type Resource = { dispose(): void };

function collect(o: THREE.Object3D, into: Set<Resource>) {
  const { geometry, material } = o as Partial<THREE.Mesh>;
  if (geometry) into.add(geometry);
  for (const m of Array.isArray(material) ? material : [material]) {
    if (m) into.add(m);
  }
}

export function disposeAll(
  resources: Iterable<Resource>,
  keep?: ReadonlySet<Resource>,
) {
  for (const r of resources) if (!keep?.has(r)) r.dispose();
}

function release(roots: THREE.Object3D[], keep?: ReadonlySet<Resource>) {
  const owned = new Set<Resource>();
  for (const root of roots) root.traverse((o) => collect(o, owned));
  disposeAll(owned, keep);
}

export function disposeObject(o: THREE.Object3D) {
  const owned = new Set<Resource>();
  collect(o, owned);
  disposeAll(owned);
}

export function disposeGroup(g: THREE.Object3D, keep?: ReadonlySet<Resource>) {
  release([g], keep);
}

export function clearGroup(group: THREE.Object3D) {
  const children = [...group.children];
  group.clear();
  release(children);
}
