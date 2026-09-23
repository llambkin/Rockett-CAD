import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
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
        open.addEventListener("error", () => reject(open.error));
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
          tx.addEventListener("error", () => reject(tx.error));
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
        open.addEventListener("error", () => reject(open.error));
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

const kept = (p: Page, key: string) =>
  p.evaluate(
    (k) =>
      new Promise<any>((resolve, reject) => {
        const open = indexedDB.open("rockett", 1);
        open.addEventListener("error", () => reject(open.error));
        open.onsuccess = () => {
          const req = open.result
            .transaction("projects")
            .objectStore("projects")
            .get(k);
          req.onsuccess = () => {
            open.result.close();
            const { name, revision, document } = req.result;
            resolve({
              name,
              revision,
              features: document.features.map((f: any) => f.name),
            });
          };
        };
      }),
    key,
  );

const poll = <T>(read: () => Promise<T>) =>
  expect.poll(read, { timeout: 10_000 });

function copied(p: Page): Promise<string> {
  const evaluated = new Set<string>();
  const onResponse = (r: Response) => {
    const id = new URL(r.url()).pathname.match(
      /^\/api\/projects\/([^/]+)\/evaluate$/,
    )?.[1];
    if (id) evaluated.add(id);
  };
  p.on("response", onResponse);
  return p
    .waitForResponse(
      (r) =>
        r.url().endsWith("/api/projects/file") &&
        r.request().method() === "POST",
    )
    .then(async (r) => {
      const id: string = (await r.json()).document.id;
      await poll(async () => evaluated.has(id)).toBe(true);
      p.off("response", onResponse);
      return id;
    });
}

const chips = (p: Page) => p.locator(".tl-chip .tl-name").allTextContents();

async function renameOpen(p: Page, name: string) {
  await p.locator(".doc-name").click();
  await p.locator(".doc-rename").fill(name);
  await p.locator(".doc-rename").press("Enter");
}

async function serverProject(name: string): Promise<string> {
  const form = new FormData();
  const file = { ...fixture, document: { ...fixture.document, name } };
  form.append("file", new Blob([JSON.stringify(file)]), `${name}.rockett`);
  const { document } = await api("/projects/file", {
    method: "POST",
    body: form,
  });
  return document.id;
}

const serverNames = async () =>
  ((await api("/projects")) as ProjectSummary[]).map((p) => p.name).toSorted();

const keptAssets = (p: Page, name: string) =>
  p.evaluate(
    (n) =>
      new Promise<Record<string, string>>((resolve, reject) => {
        const open = indexedDB.open("rockett", 1);
        open.addEventListener("error", () => reject(open.error));
        open.onsuccess = () => {
          const req = open.result
            .transaction("projects")
            .objectStore("projects")
            .getAll();
          req.onsuccess = async () => {
            open.result.close();
            const r = req.result.find((x) => x.name === n);
            const out: Record<string, string> = {};
            for (const [asset, blob] of Object.entries<Blob>(r.assets)) {
              const bytes = new Uint8Array(await blob.arrayBuffer());
              out[asset] = btoa(String.fromCharCode(...bytes));
            }
            resolve(out);
          };
        };
      }),
    name,
  );

async function moveTo(p: Page, name: string, target: string) {
  await row(p, name).click({ button: "right" });
  await p
    .locator(".context-menu")
    .getByRole("button", { name: "Move to…" })
    .click();
  const dialog = p.locator(".dialog-panel");
  await dialog
    .locator(".tree-item", { hasText: new RegExp(`^${target}$`) })
    .click();
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
}

function answer(p: Page, accept: boolean) {
  const prompts: string[] = [];
  p.once("dialog", (d) => {
    prompts.push(d.message());
    void (accept ? d.accept() : d.dismiss());
  });
  return prompts;
}

const intoBrowser = (name: string) =>
  `Move "${name}" to this browser? Other users lose access, and clearing this site's data deletes it.`;

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
    "Open",
    "Rename",
    "Duplicate",
    "Download",
    "Move to…",
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
  await poll(() => rowNames(page)).toEqual(["Motor bracket"]);
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

it("opens a browser project through a temporary copy that writes back each edit", async () => {
  await page.goto(`${app.origin}/browser`);
  const opened = copied(page);
  await row(page, "Motor plate").locator(".project-open").click();
  const id = await opened;
  await poll(() => chips(page)).toEqual(["Photo"]);
  expect(new URL(page.url()).pathname).toBe("/browser/k1");
  const listed: ProjectSummary[] = await api("/projects");
  expect(listed.map((p) => p.id)).not.toContain(id);

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
  await page.getByRole("button", { name: "Finish Sketch" }).click();
  await page.locator(".tree-item", { hasText: "Sketch1" }).click();
  await page.getByRole("button", { name: "Extrude", exact: true }).click();
  await page.getByLabel("Distance (mm)").fill("10");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const all = ["Photo", "Sketch1", "Extrude1"];
  await poll(async () => (await kept(page, "k1")).features).toEqual(all);

  const reopened = copied(page);
  await page.reload();
  const again = await reopened;
  await poll(() => chips(page)).toEqual(all);
  expect(new URL(page.url()).pathname).toBe("/browser/k1");
  await poll(
    async () => (await fetch(`${app.origin}/api/projects/${id}`)).status,
  ).toBe(404);

  await page.getByTitle("Back to projects").click();
  await row(page, "Motor plate").getByText("3 features").waitFor();
  expect(new URL(page.url()).pathname).toBe("/browser");
  await poll(
    async () => (await fetch(`${app.origin}/api/projects/${again}`)).status,
  ).toBe(404);
  expect((await api("/projects")).map((p: ProjectSummary) => p.name)).toEqual([
    "Motor bracket",
  ]);
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});

it("recreates a swept copy from the record once", async () => {
  const opened = copied(page);
  await row(page, "Motor plate").locator(".project-open").click();
  const id = await opened;
  await poll(() => chips(page)).toEqual(["Photo", "Sketch1", "Extrude1"]);
  await api(`/projects/${id}`, { method: "DELETE" });

  const recreated = copied(page);
  await renameOpen(page, "Lost rename");
  const next = await recreated;
  expect(next).not.toBe(id);
  await poll(() => chips(page)).toEqual(["Photo", "Sketch1", "Extrude1"]);
  await page.locator(".doc-name", { hasText: "Motor plate" }).waitFor();
  await renameOpen(page, "Motor base");
  await poll(async () => (await kept(page, "k1")).name).toBe("Motor base");
  expect(new URL(page.url()).pathname).toBe("/browser/k1");
  expect(failures.filter((f) => !f.includes("404"))).toEqual([]);
  failures.length = 0;
});

it("stops writing when another tab wrote the record first", async () => {
  const other = watch(await context.newPage());
  const otherOpened = copied(other);
  await other.goto(`${app.origin}/browser/k1`);
  await otherOpened;
  await poll(() => chips(other)).toEqual(["Photo", "Sketch1", "Extrude1"]);
  await renameOpen(other, "Motor cover");
  await poll(async () => (await kept(other, "k1")).name).toBe("Motor cover");
  const { revision } = await kept(other, "k1");

  await page.bringToFront();
  await page.getByTitle("Roll to after Sketch1").click();
  await page
    .locator(".error-toast")
    .getByText('"Motor base" changed in another tab. Reload to continue.')
    .waitFor();
  expect(await kept(page, "k1")).toMatchObject({
    name: "Motor cover",
    revision,
  });
  await other.close();
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});

it("keeps the copy when a 404 names something inside it", async () => {
  const opened = copied(page);
  await page.goto(`${app.origin}/browser/k1`);
  const id = await opened;
  await page.route(`**/api/projects/${id}/rename`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "feature not found", code: "not_found" }),
    }),
  );
  projectRequests.length = 0;
  await renameOpen(page, "Stale");
  await page.locator(".error-toast").getByText("feature not found").waitFor();
  await page.waitForTimeout(500);
  await page.unroute(`**/api/projects/${id}/rename`);
  expect(projectRequests).not.toContain("/api/projects/file");
  expect(new URL(page.url()).pathname).toBe("/browser/k1");
  failures.length = 0;
});

it("shows the error after the recreated copy goes missing too", async () => {
  const opened = copied(page);
  await page.goto(`${app.origin}/browser/k1`);
  const first = await opened;
  await api(`/projects/${first}`, { method: "DELETE" });
  const recreated = copied(page);
  await renameOpen(page, "Lost once");
  const second = await recreated;

  projectRequests.length = 0;
  await api(`/projects/${second}`, { method: "DELETE" });
  await renameOpen(page, "Lost twice");
  const missing = page.locator(".error-toast").getByText(/not found/);
  await missing.waitFor();
  await page.waitForTimeout(500);
  expect(projectRequests).not.toContain("/api/projects/file");
  await missing.waitFor();
  expect((await kept(page, "k1")).name).toBe("Motor cover");
  failures.length = 0;
});

it("moves a server project to this browser only after the confirm", async () => {
  const id = await serverProject("Gear plate");
  const moving = watch(await context.newPage());
  await moving.goto(app.origin);
  const dismissed = answer(moving, false);
  await moveTo(moving, "Gear plate", "This browser");
  await poll(async () => dismissed).toEqual([intoBrowser("Gear plate")]);
  expect(await serverNames()).toContain("Gear plate");
  expect(await stored(moving)).not.toContain("Gear plate");
  await moving.close();

  await page.goto(app.origin);
  const prompts = answer(page, true);
  await moveTo(page, "Gear plate", "This browser");
  await poll(() => stored(page)).toContain("Gear plate");
  expect(prompts).toEqual([intoBrowser("Gear plate")]);
  await poll(serverNames).not.toContain("Gear plate");
  await expect
    .poll(async () => (await fetch(`${app.origin}/api/projects/${id}`)).status)
    .toBe(404);
  expect(await keptAssets(page, "Gear plate")).toEqual(fixture.assets);
  await row(page, "This browser").getByText("2 projects").waitFor();
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});

it("moves a browser project into a server folder without a confirm", async () => {
  const { folder } = await api("/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Plates" }),
  });
  const moving = watch(await context.newPage());
  const prompts = answer(moving, false);
  await moving.goto(`${app.origin}/browser`);
  await moveTo(moving, "Gear plate", "Plates");
  await poll(() => stored(moving)).not.toContain("Gear plate");
  expect(prompts).toEqual([]);
  const listed: ProjectSummary[] = await api("/projects");
  const moved = listed.find((p) => p.name === "Gear plate")!;
  expect((await api("/folders")).placement[moved.id]).toBe(folder.id);
  const file = await api(`/projects/${moved.id}/file`);
  expect(file.assets).toEqual(fixture.assets);
  await moving.close();
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});

it("keeps both copies and names the one left when removing the source fails", async () => {
  const id = await serverProject("Gear cover");
  await page.goto(app.origin);
  answer(page, true);
  await page.route(`**/api/projects/${id}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Boom", code: "internal" }),
        })
      : route.continue(),
  );
  await moveTo(page, "Gear cover", "This browser");
  await page
    .locator(".error-banner")
    .getByText(
      '"Gear cover" is in this browser, but the server copy was not removed.',
    )
    .waitFor();
  await page.unroute(`**/api/projects/${id}`);
  expect(await serverNames()).toContain("Gear cover");
  expect(await stored(page)).toContain("Gear cover");
  failures.length = 0;
  expect(app.serverErrors).toEqual([]);
});

it("moves a project dropped on This browser", async () => {
  await serverProject("Gear shaft");
  await page.goto(app.origin);
  const prompts = answer(page, true);
  await row(page, "Gear shaft").dragTo(row(page, "This browser"));
  await poll(() => stored(page)).toContain("Gear shaft");
  expect(prompts).toEqual([intoBrowser("Gear shaft")]);
  await poll(serverNames).not.toContain("Gear shaft");
  expect(failures).toEqual([]);
  expect(app.serverErrors).toEqual([]);
});
