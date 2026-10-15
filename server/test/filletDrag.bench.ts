import { afterAll, beforeAll, expect, test } from "vitest";
import { gzipSync } from "node:zlib";
import type { FilletFeature } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { filletDragPart, record, SAMPLES } from "./helpers/perfFixtures.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

let app: TestApp;
beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);
afterAll(() => app.close());

let drags = 0;
const radius = () => 0.3 + (++drags % 60) * 0.01;
const sync = { async: false };

test("fillet drag many-body", { timeout: 1_800_000 }, async ({ bench }) => {
  const doc = filletDragPart();
  const fillet = doc.features.at(-1) as FilletFeature;
  const engine = engineFor(doc.id);
  const first = engine.evaluate(doc);
  expect(first.featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
  expect(first.bodies).toHaveLength(1000);
  record(
    "fillet drag engine many-body",
    await bench("fillet drag engine many-body", sync, () => {
      fillet.radius = radius();
      engine.evaluate(doc);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  dropEngine(doc.id);

  const { id } = await app.store.create("drag");
  await app.store.save({ ...doc, id });
  const opened = await app.request(`/api/projects/${id}/evaluate`);
  const held: string[] = (await opened.json()).bodies.map(
    (b: { meshKey: string }) => b.meshKey,
  );
  let etag = `"${(await app.store.load(id)).revision}"`;
  for (const [label, extra] of [
    ["", {}],
    [" held", { held }],
  ] as const) {
    let text = "";
    let wire = 0;
    const drag = async () => {
      const res = await app.request(`/api/projects/${id}/features/drag`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip",
          "If-Match": etag,
        },
        body: JSON.stringify({ feature: { radius: radius() }, ...extra }),
      });
      etag = res.headers.get("etag") ?? "";
      wire = Number(res.headers.get("content-length"));
      text = await res.text();
      expect(res.ok).toBe(true);
    };
    record(
      `fillet drag http${label} many-body`,
      await bench(`fillet drag http${label} many-body`, drag).run(SAMPLES),
      SAMPLES.iterations,
    );
    console.log(
      `fillet drag bytes${label} many-body: ${Buffer.byteLength(text)} bytes, ${gzipSync(text, { level: 1 }).length} gzipped, ${wire} on the wire`,
    );
    let parsed: unknown;
    record(
      `fillet drag parse${label} many-body`,
      await bench(`fillet drag parse${label} many-body`, sync, () => {
        parsed = JSON.parse(text);
      }).run(SAMPLES),
      SAMPLES.iterations,
    );
    record(
      `fillet drag stringify${label} many-body`,
      await bench(`fillet drag stringify${label} many-body`, sync, () => {
        JSON.stringify(parsed);
      }).run(SAMPLES),
      SAMPLES.iterations,
    );
  }
});
