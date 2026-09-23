import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { startBuiltApp, type BuiltApp } from "./builtApp";

let app: BuiltApp;
let browser: Browser;
let page: Page;
const failures: string[] = [];

beforeAll(async () => {
  app = await startBuiltApp();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (e) => failures.push(`page: ${e.message}`));
  const res = await fetch(`${app.origin}/api/projects`, {
    method: "POST",
    headers: { Origin: app.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Help" }),
  });
  const { document } = (await res.json()) as { document: { id: string } };
  await page.goto(`${app.origin}/projects/${document.id}`);
  await page.locator(".tree-item", { hasText: "XY Plane" }).waitFor();
});

afterAll(async () => {
  await browser?.close();
  await app?.close();
});

const panel = () =>
  page.locator(".dialog-panel", { hasText: "Keyboard & mouse controls" });

async function openHelp() {
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await panel().waitFor();
}

async function closeHelp() {
  await page.getByRole("button", { name: "Close controls" }).click();
  await panel().waitFor({ state: "detached" });
}

const box = async () => (await panel().boundingBox())!;

const columns = () =>
  panel()
    .locator(".dialog-body p")
    .evaluateAll(
      (ps) =>
        new Set(ps.map((p) => Math.round(p.getBoundingClientRect().left))).size,
    );

it("fills a large window with columns", async () => {
  await openHelp();
  const b = await box();
  expect(b.width).toBeGreaterThan(800);
  expect(b.width).toBeLessThanOrEqual(1600 * 0.9 + 1);
  expect(b.height).toBeLessThanOrEqual(1000 * 0.85 + 1);
  expect(await columns()).toBeGreaterThanOrEqual(3);
});

it("keeps a dragged size when reopened", async () => {
  const before = await box();
  const x = before.x + before.width - 3;
  const y = before.y + before.height - 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 300, y - 100, { steps: 5 });
  await page.mouse.up();
  const resized = await box();
  expect(resized.width).toBeCloseTo(before.width - 300, -1);
  expect(resized.height).toBeCloseTo(before.height - 100, -1);
  await closeHelp();
  await openHelp();
  const reopened = await box();
  expect(reopened.width).toBeCloseTo(resized.width, 0);
  expect(reopened.height).toBeCloseTo(resized.height, 0);
});

it("stays inside a smaller window", async () => {
  await page.setViewportSize({ width: 700, height: 500 });
  await expect
    .poll(async () => {
      const b = await box();
      return (
        b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= 700 &&
        b.y + b.height <= 500 &&
        b.width <= 700 * 0.9 + 1
      );
    })
    .toBe(true);
});

it("reflows to one scrolling column on a narrow window", async () => {
  await page.setViewportSize({ width: 420, height: 700 });
  await expect.poll(columns).toBe(1);
  const body = panel().locator(".dialog-body");
  expect(
    await body.evaluate((el) => el.scrollHeight > el.clientHeight + 1),
  ).toBe(true);
  expect(failures).toEqual([]);
});
