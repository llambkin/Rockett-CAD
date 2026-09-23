import * as THREE from "three";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { BodyPayload, Feature } from "@rockett/shared";
import { previewTints } from "../src/livePreview";
import type { Selection } from "../src/store";
import { CadViewport } from "../src/three/CadViewport";
import { syncReferenceImages } from "../src/three/referenceImages";
import { worldToClient } from "../src/three/screen";
import { renderSketches } from "../src/three/sketchRender";
import {
  IMAGE_PIXELS,
  imageScene,
  manyBodyPayloads,
  squareSketch,
} from "./helpers/perfFixtures";
import { record, SAMPLES } from "../../server/test/helpers/perfFixtures";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("./helpers/fakeRenderer")).FakeWebGLRenderer,
}));

const WIDTH = 1280;
const HEIGHT = 800;
const sync = { async: false };

let vp: CadViewport;
let bodies: BodyPayload[];

beforeAll(() => {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: WIDTH },
    clientHeight: { value: HEIGHT },
  });
  vp = new CadViewport(container);
  bodies = manyBodyPayloads();
});

afterAll(() => vp.dispose());

test("many-body", async ({ bench }) => {
  const generations = [
    bodies,
    bodies.map((p) => ({ ...p, meshKey: `${p.meshKey}'` })),
  ];
  let syncs = 0;
  record(
    "sync bodies many-body",
    await bench("sync bodies many-body", sync, () => {
      vp.syncBodies(generations[syncs++ % 2]!);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  expect(vp.bodyPayloads()).toHaveLength(1000);
  record(
    "sync bodies unchanged many-body",
    await bench("sync bodies unchanged many-body", sync, () => {
      vp.syncBodies(bodies.map((p) => ({ ...p })));
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  expect(bodies[0]!.indices.length / 3).toBe(2028);

  vp.zoomToFit(false);
  vp.render();
  const hover = { faces: true, edges: true, vertices: true };
  const hit = vp.pick(WIDTH / 2, HEIGHT / 2, hover);
  expect(hit?.selection.kind).toMatch(/^(face|edge|vertex)$/);
  record(
    "pick hover many-body",
    await bench("pick hover many-body", sync, () => {
      vp.pick(WIDTH / 2, HEIGHT / 2, hover);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );

  const faces: Selection[] = bodies[0]!.faces.slice(0, 2).map((f) => ({
    kind: "face",
    bodyId: bodies[0]!.bodyId,
    faceName: f.name,
  }));
  let highlights = 0;
  record(
    "highlight face many-body",
    await bench("highlight face many-body", sync, () => {
      vp.clearHighlights();
      vp.addHighlight(faces[highlights++ % 2]!, "hover");
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  vp.clearHighlights();
  vp.syncBodies([]);
});

test("preview tints many-body", async ({ bench }) => {
  const join = { type: "extrude", operation: "join" } as Feature;
  const after: BodyPayload[] = JSON.parse(JSON.stringify(bodies));
  record(
    "preview tints many-body",
    await bench("preview tints many-body", sync, () => {
      previewTints(join, bodies, after);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  expect(previewTints(join, bodies, after).size).toBe(0);
});

test("sketch hover 2000 entities", async ({ bench }) => {
  const sketch = squareSketch();
  expect(sketch.entities).toHaveLength(2000);
  renderSketches(vp, [sketch], [], null);
  vp.setView([0, 0, 1], [0, 1, 0], false);
  vp.zoomToFit(false);
  vp.zoomBy(0.5);
  vp.render();
  const points = new Map(
    sketch.entities.flatMap((e) => (e.kind === "point" ? [[e.id, e]] : [])),
  );
  const lines = ["sq130-l0", "sq131-l0"];
  const cursors = lines.map((id) => {
    const a = points.get(id.replace("l0", "p0"))!;
    const b = points.get(id.replace("l0", "p1"))!;
    const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    return worldToClient(vp.canvasRect(), vp.camera, mid);
  });
  const hovered: (Selection | null)[] = [];
  let moves = 0;
  record(
    "sketch hover 2000 entities",
    await bench("sketch hover 2000 entities", sync, () => {
      const at = cursors[moves++ % 2]!;
      const hover =
        vp.pick(at.x, at.y, { sketchEntities: true, profiles: false })
          ?.selection ?? null;
      renderSketches(vp, [sketch], [], hover);
      vp.render();
      hovered.push(hover);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  const expected = lines.map((entityId) => ({
    kind: "sketchEntity",
    sketchId: sketch.sketchId,
    entityId,
  }));
  expect(hovered).toEqual(hovered.map((_, i) => expected[i % 2]));
  renderSketches(vp, [], [], null);
});

test("texture scene", async ({ bench }) => {
  const pending: (() => void)[] = [];
  vi.spyOn(THREE.ImageLoader.prototype, "load").mockImplementation(
    (_url, onLoad) => {
      const image = Object.assign(document.createElement("img"), {
        width: IMAGE_PIXELS,
        height: IMAGE_PIXELS,
      });
      pending.push(() => onLoad?.(image));
      return image;
    },
  );
  let scenes = 0;
  record(
    "texture scene bytes",
    await bench("texture scene bytes", sync, () => {
      const { doc, evaluation } = imageScene(`perf-images-${scenes++}`);
      syncReferenceImages(vp, doc, evaluation);
      for (const load of pending.splice(0)) load();
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  const textures = new Set<THREE.Texture>();
  vp.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material.map) textures.add(o.material.map);
  });
  expect(textures.size).toBe(50);
  let bytes = 0;
  for (const texture of textures) {
    const { width, height } = texture.image as HTMLImageElement;
    expect([width, height]).toEqual([IMAGE_PIXELS, IMAGE_PIXELS]);
    for (let w = width, h = height; w > 0 || h > 0; w >>= 1, h >>= 1) {
      bytes += Math.max(w, 1) * Math.max(h, 1) * 4;
      if (!texture.generateMipmaps) break;
    }
  }
  console.log(`texture scene bytes: ${bytes} bytes`);
});
