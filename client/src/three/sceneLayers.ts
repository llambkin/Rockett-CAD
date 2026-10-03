import * as THREE from "three";
import { clearGroup } from "./dispose";

export interface LayerHandle {
  group: THREE.Group;
  clear(): void;
  dispose(): void;
}

export function sceneLayers(parent: THREE.Object3D) {
  const layers = new Map<string, LayerHandle>();

  const addLayer = (id: string): LayerHandle => {
    if (layers.has(id)) {
      throw new Error(`scene layer ${id} is already registered`);
    }
    const group = new THREE.Group();
    group.name = id;
    parent.add(group);
    const layer: LayerHandle = {
      group,
      clear: () => clearGroup(group),
      dispose: () => {
        if (layers.get(id) !== layer) return;
        layers.delete(id);
        group.removeFromParent();
        clearGroup(group);
      },
    };
    layers.set(id, layer);
    return layer;
  };

  const dispose = () => {
    for (const layer of [...layers.values()].reverse()) layer.dispose();
  };

  return { addLayer, dispose };
}
