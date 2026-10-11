import { act } from "react";
import { expect, it } from "vitest";
import { POSTS } from "../src/server/posts.js";
import { CAM_EXTENSION, type CamData } from "../src/shared/document.js";
import {
  entry,
  exports,
  fetchMock,
  flush,
  library,
  mine,
  open,
  router,
  saved,
  serve,
} from "./helpers/camClient.js";

const camSaves = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").length;

const exportButton = (panel: Element) =>
  [...panel.querySelectorAll("button")].find(
    (b) => b.textContent === "Export",
  )!;

async function exportNc(panel: Element) {
  await act(async () => exportButton(panel).click());
  await flush();
}

it("lists a library post as unqualified and copies its latest version onto the picked setup on export", async () => {
  const panel = await open("NC Program", "rockett.cam.nc");
  const post = [...panel.querySelectorAll("label.field")]
    .find((l) => l.querySelector("span")?.textContent === "Post")!
    .querySelector("select")!;
  expect([...post.options].map((o) => o.textContent)).toEqual([
    ...[...POSTS.values()].map(({ label }) => label),
    "My GRBL (unqualified)",
  ]);
  await act(async () => {
    post.value = "user.my-grbl";
    post.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const before = saved.revision;
  await exportNc(panel);

  expect(camSaves()).toBe(1);
  const [setup] = (saved.extensions[CAM_EXTENSION]!.data as CamData).setups;
  expect(setup!.post).toEqual({ ...mine, libraryRef: { id: "user.my-grbl" } });
  const path = `/projects/p1/m/rockett/cam/nc/m1/user.my-grbl/perFile/${setup!.id}`;
  expect(exports).toEqual([{ path, revision: before + 1 }]);

  await exportNc(panel);
  expect(camSaves()).toBe(1);
  expect(exports).toEqual([
    { path, revision: before + 1 },
    { path, revision: before + 1 },
  ]);

  const replaced = { ...mine, label: "My GRBL 2" };
  library.posts = [replaced];
  await exportNc(panel);
  expect(camSaves()).toBe(2);
  const [again] = (saved.extensions[CAM_EXTENSION]!.data as CamData).setups;
  expect(again!.post).toEqual({
    ...replaced,
    libraryRef: { id: "user.my-grbl" },
  });
  expect(exports.at(-1)).toEqual({ path, revision: before + 2 });
});

it("says the machine's default post is gone beside the disabled Export", async () => {
  library.posts = [];
  fetchMock.mockImplementation(async (url, init) =>
    String(url) === "/api/m/rockett/cam/machines"
      ? entry([{ ...router, post: mine.id }])
      : serve(url, init),
  );
  try {
    const panel = await open("NC Program", "rockett.cam.nc");
    expect(exportButton(panel).disabled).toBe(true);
    expect(panel.querySelector(".dialog-body")!.lastChild!.textContent).toBe(
      "Router's default post is gone. Pick a post.",
    );

    const post = [...panel.querySelectorAll("label.field")]
      .find((l) => l.querySelector("span")?.textContent === "Post")!
      .querySelector("select")!;
    await act(async () => {
      post.value = "grbl";
      post.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(exportButton(panel).disabled).toBe(false);
    expect(panel.textContent).not.toContain("default post is gone");
  } finally {
    fetchMock.mockImplementation(serve);
  }
});
