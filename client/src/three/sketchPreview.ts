import * as THREE from "three";
import { sampleArc, type PlaneFrame, type SketchEntity } from "@rockett/shared";
import { uv3 } from "./CadViewport";
import { themeColor } from "../theme/tokens";

export function previewCurves(
  entities: SketchEntity[],
  frame: PlaneFrame,
  skip: ReadonlySet<string> = new Set(),
): THREE.Group {
  const group = new THREE.Group();
  const points = new Map(
    entities
      .filter(
        (e): e is Extract<SketchEntity, { kind: "point" }> =>
          e.kind === "point",
      )
      .map((e) => [e.id, e]),
  );
  for (const e of entities) {
    if (skip.has(e.id) || e.kind === "point") continue;
    let coords: number[] = [];
    if (e.kind === "line") {
      const a = points.get(e.p1),
        b = points.get(e.p2);
      if (!a || !b) continue;
      coords = [a.x, a.y, b.x, b.y];
    } else if (e.kind === "circle") {
      const c = points.get(e.center);
      if (!c) continue;
      for (let i = 0; i <= 96; i++)
        coords.push(
          c.x + e.radius * Math.cos((i * Math.PI) / 48),
          c.y + e.radius * Math.sin((i * Math.PI) / 48),
        );
    } else {
      const c = points.get(e.center),
        a = points.get(e.start),
        b = points.get(e.end);
      if (!c || !a || !b) continue;
      coords = sampleArc(c.x, c.y, a.x, a.y, b.x, b.y, 64);
    }
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < coords.length; i += 2)
      positions.push(uv3(frame, coords[i]!, coords[i + 1]!));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(positions),
      new THREE.LineBasicMaterial({
        color: themeColor("offset"),
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    line.renderOrder = 9;
    group.add(line);
  }
  return group;
}
