import type { ExtrudeFeature } from "@rockett/shared";
import { initKernel, volumeOf } from "../../src/geometry/kernel.js";
import { engineFor } from "../../src/geometry/engine.js";
import { DRAG_BODY, pushPullPart } from "./perfFixtures.js";

await initKernel();
const doc = pushPullPart();
const push = doc.features.at(-1) as ExtrudeFeature;
const engine = engineFor(doc.id);
const timed = () => {
  const t0 = performance.now();
  const result = engine.evaluate(doc);
  return { ms: performance.now() - t0, result };
};
const open = timed();
const edits = Array.from({ length: 10 }, (_, i) => {
  push.distance = 10 + (i % 5);
  return timed().ms;
});
push.distance = 10;
const final = timed().result;
process.stdout.write(
  JSON.stringify({
    openMs: open.ms,
    editMs: edits.slice(2).sort((a, b) => a - b),
    statuses: final.featureStatuses.map((s) => s.status),
    bodies: final.bodies.length,
    faces: final.bodies.find((b) => b.bodyId === DRAG_BODY)?.faces.length,
    volume: volumeOf(engine.stateAt(doc).bodies.get(DRAG_BODY)!.shape),
  }),
  () => process.exit(0),
);
