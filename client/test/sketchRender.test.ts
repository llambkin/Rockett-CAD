import * as THREE from "three";
import { expect, it } from "vitest";
import { detectProfiles, type SketchEntity } from "@rockett/shared";
import type { CadViewport } from "../src/three/CadViewport";
import {
  renderSketches,
  type SketchRenderInput,
} from "../src/three/sketchRender";

function square(x: number): SketchEntity[] {
  return [
    { id: "a", kind: "point", x, y: 0 },
    { id: "b", kind: "point", x: x + 10, y: 0 },
    { id: "c", kind: "point", x: x + 10, y: 10 },
    { id: "d", kind: "point", x, y: 10 },
    { id: "ab", kind: "line", p1: "a", p2: "b" },
    { id: "bc", kind: "line", p1: "b", p2: "c" },
    { id: "cd", kind: "line", p1: "c", p2: "d" },
    { id: "da", kind: "line", p1: "d", p2: "a" },
    { id: "o", kind: "circle", center: "a", radius: 3 },
  ];
}

function evaluated(sketchId: string, entities: SketchEntity[]) {
  return {
    sketchId,
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
    entities,
    profiles: detectProfiles(entities),
  } as const;
}

function inputs(sketches: ReturnType<typeof evaluated>[]): SketchRenderInput[] {
  return JSON.parse(JSON.stringify(sketches)).map((sk: SketchRenderInput) => ({
    ...sk,
    showProfiles: true,
    usedProfileIds: new Set([sk.profiles![0]!.id]),
    active: false,
    dim: true,
  }));
}

function setup() {
  const root = new THREE.Group();
  const viewport = {
    getSketchRoot: () => root,
    requestRender: () => {},
  } as unknown as CadViewport;
  const sketches = [evaluated("s1", square(0)), evaluated("s2", square(20))];
  renderSketches(viewport, inputs(sketches), [], null);
  return { root, viewport, sketches, groups: [...root.children] };
}

const nextGeometryId = () => new THREE.BufferGeometry().id;

it("keeps every sketch group when a new evaluation repeats the sketches", () => {
  const { root, viewport, sketches, groups } = setup();
  expect(groups).toHaveLength(2);

  const before = nextGeometryId();
  renderSketches(viewport, inputs(sketches), [], null);
  expect(nextGeometryId()).toBe(before + 1);
  expect(root.children).toHaveLength(2);
  root.children.forEach((group, i) => expect(group).toBe(groups[i]));
});

it("rebuilds only the sketch whose entity or hover changed", () => {
  const { root, viewport, sketches, groups } = setup();
  const moved = square(20).map((e) =>
    e.id === "c" && e.kind === "point" ? { ...e, y: 12 } : e,
  );
  renderSketches(
    viewport,
    inputs([sketches[0]!, evaluated("s2", moved)]),
    [],
    null,
  );
  expect(root.children[0]).toBe(groups[0]);
  expect(root.children[1]).not.toBe(groups[1]);
  expect(groups[1]!.parent).toBeNull();

  const kept = root.children[1];
  renderSketches(viewport, inputs([sketches[0]!, evaluated("s2", moved)]), [], {
    kind: "sketchEntity",
    sketchId: "s1",
    entityId: "ab",
  });
  expect(root.children[0]).not.toBe(groups[0]);
  expect(root.children[1]).toBe(kept);
});
