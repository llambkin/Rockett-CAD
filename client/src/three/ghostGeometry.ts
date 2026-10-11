import * as THREE from "three";
import type { PreviewGhost } from "../livePreview";
import { meshOf, type LayerBody } from "./meshes";

function refill(
  geom: THREE.BufferGeometry,
  old: THREE.BufferAttribute | null,
  values: number[],
  itemSize: number,
): THREE.BufferAttribute {
  if (old && old.array.length >= values.length) {
    old.needsUpdate = true;
    return old.set(values);
  }
  if (old) geom.dispose();
  const size = Math.max(values.length, 2 * (old?.array.length ?? 0));
  const array = itemSize === 1 ? new Uint32Array(size) : new Float32Array(size);
  return new THREE.BufferAttribute(array, itemSize).set(values);
}

export function fillGhost(
  geom: THREE.BufferGeometry,
  body: LayerBody,
  ranges: PreviewGhost["ranges"],
) {
  const shape = meshOf(body);
  if (!shape) {
    geom.setDrawRange(0, 0);
    return;
  }
  const { meshKey } = body;
  const { positions, normals, indices } = shape;
  if (geom.userData.meshKey !== meshKey) {
    geom.userData.meshKey = meshKey;
    geom.boundingSphere = null;
    const attr = (name: string) =>
      (geom.getAttribute(name) as THREE.BufferAttribute | undefined) ?? null;
    geom.setAttribute("position", refill(geom, attr("position"), positions, 3));
    geom.setAttribute("normal", refill(geom, attr("normal"), normals, 3));
  }
  const picked = ranges.flatMap(({ start, count }) =>
    indices.slice(start, start + count),
  );
  geom.setIndex(refill(geom, geom.index, picked, 1));
  geom.setDrawRange(0, picked.length);
}
