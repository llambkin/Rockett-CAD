import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { clearGroup, disposeGroup } from "../src/three/dispose";

function nestedGroup() {
  const shared = new THREE.MeshBasicMaterial();
  const map = new THREE.Texture();
  const mapped = new THREE.MeshBasicMaterial({ map });
  const geometries = [0, 1, 2, 3].map(() => new THREE.BufferGeometry());
  const inner = new THREE.Group();
  inner.add(
    new THREE.Mesh(geometries[0], shared),
    new THREE.Mesh(geometries[1], [shared, mapped]),
  );
  const root = new THREE.Group();
  root.add(
    inner,
    new THREE.Mesh(geometries[2], shared),
    new THREE.Line(geometries[3], mapped),
  );
  const spies = [...geometries, shared, mapped, map].map((r) =>
    vi.spyOn(r, "dispose"),
  );
  return { root, map, spies: spies.slice(0, -1), mapSpy: spies.at(-1)! };
}

describe("dispose helpers", () => {
  it("disposeGroup releases each geometry and material once and keeps the map", () => {
    const { root, spies, mapSpy } = nestedGroup();
    disposeGroup(root);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(mapSpy).not.toHaveBeenCalled();
  });

  it("clearGroup empties the group and releases each resource once", () => {
    const { root, spies, mapSpy } = nestedGroup();
    clearGroup(root);
    expect(root.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(mapSpy).not.toHaveBeenCalled();
  });

  it("client/src disposes geometry and material only through dispose.ts", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const allowed = new Set([
      "three/dispose.ts",
      "three/ExtrudeGizmo.ts",
      "three/MoveGizmo.ts",
      "three/RevolveGizmo.ts",
    ]);
    const offenders = readdirSync(src, { recursive: true })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f) && !allowed.has(f))
      .filter((f) =>
        /\b(geometry|material)\??\.dispose\b/.test(
          readFileSync(join(src, f), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
