import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import type {
  EvaluateResult,
  FolderTree,
  ProjectSummary,
} from "@rockett/shared";
import { startBuiltApp, type BuiltApp } from "./builtApp";

let app: BuiltApp;
let browser: Browser;
let page: Page;
const failures: string[] = [];

beforeAll(async () => {
  app = await startBuiltApp();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(10_000);
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => failures.push(`page: ${e.message}`));
  page.on("requestfailed", (r) => failures.push(`request: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`http ${r.status()}: ${r.url()}`);
  });
});

afterAll(async () => {
  await browser?.close();
  await app?.close();
});

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${app.origin}/api${path}`);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

function extents(bbox: { min: number[]; max: number[] }) {
  return bbox.max
    .map((v, i) => Math.abs(v - bbox.min[i]!))
    .toSorted((a, b) => b - a);
}

function readStl(buf: Buffer) {
  const count = buf.readUInt32LE(80);
  expect(buf.length).toBe(84 + count * 50);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50 + 12;
    const p = [0, 1, 2].map((v) =>
      [0, 1, 2].map((c) => buf.readFloatLE(at + v * 12 + c * 4)),
    ) as [number[], number[], number[]];
    for (const q of p)
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c]!, q[c]!);
        max[c] = Math.max(max[c]!, q[c]!);
      }
    const [a, b, c] = p;
    volume +=
      (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
        a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
      6;
  }
  return { count, volume: Math.abs(volume), extents: extents({ min, max }) };
}

const chips = () => page.locator(".tl-chip");
const bodiesHeader = () => page.locator(".tree-header", { hasText: "Bodies" });

it("creates, edits, extrudes, rolls back, exports and reopens a project", async () => {
  await page.goto(app.origin);
  await page.getByText("No projects yet").waitFor();
  await page.getByLabel("New project name").fill("Smoke plate");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await page.locator(".tree-item", { hasText: "XY Plane" }).click();
  await page.getByRole("button", { name: "Create Sketch" }).click();
  await page.getByRole("button", { name: "Rect", exact: true }).click();
  const box = (await page.locator(".viewport-container").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 5, cy + 5);
  await page.mouse.move(cx, cy, { steps: 3 });
  await page.mouse.click(cx, cy);
  await page.mouse.move(cx + 60, cy - 40, { steps: 4 });
  await page.keyboard.type("40");
  await page.keyboard.press("Tab");
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await page.getByText("Fully constrained").waitFor();

  await page.locator(".dim-label", { hasText: "40" }).click();
  await page.getByLabel("Dimension value").fill("50");
  await page.getByLabel("Dimension value").press("Enter");
  await page.locator(".dim-label", { hasText: "50" }).waitFor();
  await page.getByText("Fully constrained").waitFor();
  await page.getByRole("button", { name: "Finish Sketch" }).click();

  const [project] = await api<ProjectSummary[]>("/projects");
  const id = project!.id;
  const sketched = await api<EvaluateResult>(`/projects/${id}/evaluate`);
  expect(sketched.sketches[0]!.solveStatus).toBe("fully_constrained");
  expect(sketched.sketches[0]!.profiles).toHaveLength(1);

  await page.locator(".tree-item", { hasText: "Sketch1" }).click();
  await page.getByRole("button", { name: "Extrude", exact: true }).click();
  await page.getByLabel("Distance (mm)").fill("10");
  await bodiesHeader().getByText("Bodies (1)").waitFor();
  await expect.poll(() => chips().count(), { timeout: 10_000 }).toBe(2);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect.poll(() => chips().count(), { timeout: 10_000 }).toBe(2);

  await page.locator(".tree-item", { hasText: "Sketch1" }).click();
  await page.getByRole("button", { name: "Extrude", exact: true }).click();
  await page.getByLabel("Distance (mm)").fill("5");
  await expect.poll(() => chips().count(), { timeout: 10_000 }).toBe(3);
  await page.keyboard.press("Escape");
  await expect.poll(() => chips().count(), { timeout: 10_000 }).toBe(2);

  const solid = await api<EvaluateResult>(`/projects/${id}/evaluate`);
  expect(solid.bodies).toHaveLength(1);
  expect(extents(solid.bodies[0]!.bbox)).toEqual(
    [50, 20, 10].map((n) => expect.closeTo(n, 6)),
  );

  await page.getByTitle("Roll to after Sketch1").click();
  await bodiesHeader().getByText("Bodies (0)").waitFor();
  await expect
    .poll(() => chips().nth(1).getAttribute("class"))
    .toContain("rolledback");
  const rolled = await api<EvaluateResult>(`/projects/${id}/evaluate`);
  expect(rolled.bodies).toHaveLength(0);
  expect(rolled.featureStatuses.map((s) => s.status)).toEqual([
    "ok",
    "rolledBack",
  ]);

  await page.getByRole("button", { name: "⏭" }).click();
  await bodiesHeader().getByText("Bodies (1)").waitFor();
  await expect
    .poll(() => chips().nth(1).getAttribute("class"))
    .not.toContain("rolledback");

  await page.getByRole("button", { name: "STL / 3MF" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.stl$/);
  const stl = readStl(await readFile((await download.path())!));
  expect(stl.count).toBeGreaterThanOrEqual(12);
  expect(stl.volume).toBeCloseTo(50 * 20 * 10, 1);
  expect(stl.extents).toEqual([50, 20, 10].map((n) => expect.closeTo(n, 4)));

  await page.getByTitle("Back to projects").click();
  await page
    .locator(".project-row", { hasText: "Smoke plate" })
    .getByText("2 features")
    .waitFor();
  await page.locator(".project-open", { hasText: "Smoke plate" }).click();
  await bodiesHeader().getByText("Bodies (1)").waitFor();
  await expect
    .poll(() => chips().locator(".tl-name").allTextContents())
    .toEqual(["Sketch1", "Extrude1"]);
  const reopened = await api<EvaluateResult>(`/projects/${id}/evaluate`);
  expect(extents(reopened.bodies[0]!.bbox)).toEqual(
    [50, 20, 10].map((n) => expect.closeTo(n, 6)),
  );

  expect(new URL(page.url()).pathname).toBe(`/projects/${id}`);
  await page.reload();
  await bodiesHeader().getByText("Bodies (1)").waitFor();
  await expect
    .poll(() => chips().locator(".tl-name").allTextContents())
    .toEqual(["Sketch1", "Extrude1"]);
  await page.goBack();
  await page.locator(".project-open", { hasText: "Smoke plate" }).waitFor();
  expect(new URL(page.url()).pathname).toBe("/");

  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});

it("orbits on a right-drag and opens the view menu on a still right-click", async () => {
  await page.goto(app.origin);
  await page.getByLabel("New project name").fill("Menu check");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const canvas = page.locator(".viewport-container > canvas");
  await canvas.waitFor();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.7;
  const menu = page.locator(".context-menu");

  await page.waitForTimeout(300);
  const before = await canvas.screenshot();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(before)).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 80, y - 40, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(100);
  expect(await menu.count()).toBe(0);
  expect((await canvas.screenshot()).equals(before)).toBe(false);

  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await menu.getByRole("button", { name: "Fit" }).waitFor();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });

  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});

it("keeps every toolbar label inside its group", async () => {
  const overflowing = () =>
    page.locator(".tb-title").evaluateAll((titles) =>
      titles.flatMap((title) => {
        const group = title.closest(".tb-group")!;
        const style = getComputedStyle(group);
        const edge =
          group.getBoundingClientRect().right -
          parseFloat(style.paddingRight) -
          parseFloat(style.borderRightWidth);
        const over = title.getBoundingClientRect().right - edge;
        return over > 0.5 ? [`${title.textContent} +${over.toFixed(1)}px`] : [];
      }),
    );

  await page.goto(app.origin);
  await page.getByLabel("New project name").fill("Ribbon");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.locator(".tb-title", { hasText: "CONSTRUCT" }).waitFor();
  expect(await overflowing()).toEqual([]);

  await page.locator(".tree-item", { hasText: "XY Plane" }).click();
  await page.getByRole("button", { name: "Create Sketch" }).click();
  await page.locator(".tb-title", { hasText: "CONSTRAIN" }).waitFor();
  expect(await overflowing()).toEqual([]);
});

it("drags a project into a folder and Back to projects returns there", async () => {
  const path = () => new URL(page.url()).pathname;
  await page.goto(app.origin);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Brackets");
  await page.getByLabel("Folder name").press("Enter");
  const folder = page.locator(".project-row", { hasText: "Brackets" });
  await folder.getByText("0 items").waitFor();
  await page.locator(".project-row", { hasText: "Smoke plate" }).dragTo(folder);
  await folder.getByText("1 item").waitFor();
  const { folders } = await api<FolderTree>("/folders");

  await folder.locator(".project-open").click();
  expect(path()).toBe(`/folders/${folders[0]!.id}`);
  await page.locator(".project-open", { hasText: "Smoke plate" }).click();
  await bodiesHeader().getByText("Bodies (1)").waitFor();
  await page.getByTitle("Back to projects").click();
  await page.locator(".breadcrumb", { hasText: "Brackets" }).waitFor();
  expect(path()).toBe(`/folders/${folders[0]!.id}`);

  await page
    .locator(".breadcrumb")
    .getByRole("button", { name: "Projects" })
    .click();
  await folder.waitFor();
  expect(path()).toBe("/");
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});
