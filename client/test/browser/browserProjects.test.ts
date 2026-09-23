import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import type { ProjectFile, ProjectSummary } from "@rockett/shared";
import { startBuiltApp, type BuiltApp } from "./builtApp";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let app: BuiltApp;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let fixture: ProjectFile;
const failures: string[] = [];
const projectRequests: string[] = [];

function watch(p: Page) {
  p.setDefaultTimeout(10_000);
  p.on("console", (m) => {
    if (m.type() === "error") failures.push(`console: ${m.text()}`);
  });
  p.on("pageerror", (e) => failures.push(`page: ${e.message}`));
  p.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/projects")) projectRequests.push(path);
  });
  return p;
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${app.origin}/api${path}`, {
    ...init,
    headers: { Origin: app.origin, ...init.headers },
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function makeFixture(): Promise<ProjectFile> {
  const json = { "Content-Type": "application/json" };
  const { document } = await api("/projects", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: "Motor mount" }),
  });
  const image = new FormData();
  image.append("image", new Blob([png]), "a.png");
  const { assetId } = await api(`/projects/${document.id}/assets`, {
    method: "POST",
    body: image,
  });
  const feature = {
    id: "img",
    type: "referenceImage",
    name: "Photo",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    assetId,
    fileName: "a.png",
    transform: { u: 0, v: 0, rotation: 0, scale: 1 },
    opacity: 0.5,
    visible: true,
    width: 1,
    height: 1,
  };
  await api(`/projects/${document.id}/features`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ feature }),
  });
  const file = await api(`/projects/${document.id}/file`);
  await api(`/projects/${document.id}`, { method: "DELETE" });
  return file;
}

async function seed(p: Page, file: ProjectFile) {
  await p.evaluate(
    (f) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("rockett", 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("projects", { keyPath: "key" });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const assets = Object.fromEntries(
            Object.entries(f.assets).map(([name, b64]) => [
              name,
              new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]),
            ]),
          );
          const size = Object.values(assets).reduce(
            (sum, blob) => sum + blob.size,
            new Blob([JSON.stringify(f.document)]).size,
          );
          const tx = open.result.transaction("projects", "readwrite");
          tx.objectStore("projects").put({
            key: "k1",
            name: f.document.name,
            modifiedAt: f.document.modifiedAt,
            featureCount: f.document.features.length,
            size,
            revision: 1,
            document: f.document,
            assets,
          });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    file,
  );
}

const stored = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("rockett", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result
            .transaction("projects")
            .objectStore("projects")
            .getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result.map((r) => r.name).toSorted());
          };
        };
      }),
  );

const rowNames = (p: Page) =>
  p.locator(".project-row .project-open b").allTextContents();
const row = (p: Page, name: string) =>
  p.locator(".project-row", {
    has: p.locator("b", { hasText: new RegExp(`^${name}$`) }),
  });

beforeAll(async () => {
  app = await startBuiltApp();
  fixture = await makeFixture();
  browser = await chromium.launch();
  context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
  });
  page = watch(await context.newPage());
});

afterAll(async () => {
  await browser?.close();
  await app?.close();
});

it("lists a seeded record under This browser with its size", async () => {
  await page.goto(app.origin);
  await seed(page, fixture);
  await page.reload();
  const pinned = row(page, "This browser");
  await pinned.getByText("1 project").waitFor();
  expect((await rowNames(page))[0]).toBe("This browser");
  expect(await pinned.locator(".icon-btn").count()).toBe(0);

  await pinned.locator(".project-open").click();
  expect(new URL(page.url()).pathname).toBe("/browser");
  expect(await page.locator(".breadcrumb > *").allTextContents()).toEqual([
    "Projects",
    "This browser",
  ]);
  const bytes =
    Buffer.byteLength(JSON.stringify(fixture.document)) + png.length;
  await row(page, "Motor mount")
    .getByText(`1 features · `)
    .filter({ hasText: `${bytes} B` })
    .waitFor();
});

it("renames, duplicates, downloads and deletes in IndexedDB without calling the server", async () => {
  projectRequests.length = 0;
  await row(page, "Motor mount")
    .getByRole("button", { name: "Rename Motor mount" })
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Motor bracket");
  await page.getByLabel("Project name", { exact: true }).press("Enter");
  await row(page, "Motor bracket").waitFor();

  await row(page, "Motor bracket").click({ button: "right" });
  expect(await page.locator(".context-menu button").allTextContents()).toEqual([
    "Rename",
    "Duplicate",
    "Download",
    "Delete",
  ]);
  await page
    .locator(".context-menu")
    .getByRole("button", { name: "Duplicate" })
    .click();
  await row(page, "Motor bracket \\(copy\\)").waitFor();
  expect(await stored(page)).toEqual(["Motor bracket", "Motor bracket (copy)"]);

  const prompts: string[] = [];
  page.once("dialog", (d) => {
    prompts.push(d.message());
    void d.accept();
  });
  await page
    .getByRole("button", { name: "Delete Motor bracket (copy)" })
    .click();
  await expect.poll(() => rowNames(page)).toEqual(["Motor bracket"]);
  expect(prompts).toEqual(['Delete project "Motor bracket (copy)"?']);
  expect(await stored(page)).toEqual(["Motor bracket"]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Motor bracket" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Motor bracket.rockett");
  const bytes = await readFile((await download.path())!);
  expect(projectRequests).toEqual([]);

  const file = JSON.parse(bytes.toString("utf8"));
  expect(file.assets).toEqual(fixture.assets);
  expect(file.document.name).toBe("Motor bracket");
  const form = new FormData();
  form.append("file", new Blob([bytes]), "Motor bracket.rockett");
  await api("/projects/file", { method: "POST", body: form });
  const listed: ProjectSummary[] = await api("/projects");
  expect(listed.map((p) => p.name)).toEqual(["Motor bracket"]);
});

it("a second page shows a rename after it regains focus", async () => {
  const other = watch(await context.newPage());
  await other.goto(`${app.origin}/browser`);
  await row(other, "Motor bracket").waitFor();

  await page.bringToFront();
  await row(page, "Motor bracket")
    .getByRole("button", { name: "Rename Motor bracket" })
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Motor plate");
  await page.getByLabel("Project name", { exact: true }).press("Enter");
  await row(page, "Motor plate").waitFor();
  expect(await rowNames(other)).toEqual(["Motor bracket"]);

  await other.bringToFront();
  await other.evaluate(() => window.dispatchEvent(new Event("focus")));
  await row(other, "Motor plate").waitFor();
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});
