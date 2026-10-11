import * as THREE from "three";
import type { Dispose, Layer } from "@rockett/plugin-api";
import { createRegistry } from "@rockett/shared";
import { clearGroup, disposeGroup, disposeObject } from "./dispose";

export interface LayerHandle {
  group: THREE.Group;
  clear(): void;
  dispose(): void;
}

const moduleLayers = createRegistry<Layer>("scene layer", (l) => l.id);
export const registerLayer = moduleLayers.register;

export function sceneLayers(parent: THREE.Object3D) {
  const layers = new Map<string, LayerHandle>();
  let unmountModules: Dispose | undefined;

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

  const mountModuleLayers = (requestRender: () => void) => {
    const mounted = new Map<Layer, Dispose>();
    const attach = ({ id, mount }: Layer): Dispose => {
      const handle = addLayer(id);
      const unmount = mount({
        group: handle.group,
        requestRender,
        disposeObject,
        disposeGroup,
        clearGroup,
      });
      return () => {
        unmount?.();
        handle.dispose();
      };
    };
    const sync = () => {
      const now = moduleLayers.list();
      for (const [layer, unmount] of mounted) {
        if (now.includes(layer)) continue;
        mounted.delete(layer);
        unmount();
      }
      for (const layer of now)
        if (!mounted.has(layer)) mounted.set(layer, attach(layer));
      requestRender();
    };
    const stop = moduleLayers.subscribe(sync);
    sync();
    unmountModules = () => {
      stop();
      for (const unmount of [...mounted.values()].toReversed()) unmount();
      mounted.clear();
    };
  };

  const dispose = () => {
    unmountModules?.();
    for (const layer of [...layers.values()].toReversed()) layer.dispose();
  };

  return { addLayer, mountModuleLayers, dispose };
}
