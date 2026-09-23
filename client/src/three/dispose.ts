import type * as THREE from "three";

type Resource = { dispose(): void };

function collect(o: THREE.Object3D, into: Set<Resource>) {
  const { geometry, material } = o as Partial<THREE.Mesh>;
  if (geometry) into.add(geometry);
  for (const m of Array.isArray(material) ? material : [material]) {
    if (m) into.add(m);
  }
}

function release(roots: THREE.Object3D[]) {
  const owned = new Set<Resource>();
  for (const root of roots) root.traverse((o) => collect(o, owned));
  for (const r of owned) r.dispose();
}

export function disposeObject(o: THREE.Object3D) {
  const owned = new Set<Resource>();
  collect(o, owned);
  for (const r of owned) r.dispose();
}

export function disposeGroup(g: THREE.Object3D) {
  release([g]);
}

export function clearGroup(group: THREE.Object3D) {
  const children = [...group.children];
  group.clear();
  release(children);
}
