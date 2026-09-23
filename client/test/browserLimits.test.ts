import { afterEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
} from "@rockett/shared";
import {
  browserProjectFile,
  fitsWithImage,
  fromProjectFile,
  moveToBrowser,
  projectFileSize,
} from "../src/browserProjects";
import { api, watchProject } from "../src/api";

const MB = 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
  watchProject(null);
});

function recordWith(assetBytes: number) {
  const record = fromProjectFile({
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    document: createEmptyDocument("d1", "Big plate"),
    assets: {},
  });
  return {
    ...record,
    assets: {
      "0123456789abcdef.png": new Blob([new Uint8Array(assetBytes)]),
    },
  };
}

it("sizes the project file a record uploads", async () => {
  const record = recordWith(1000);
  expect(projectFileSize(record)).toBe((await browserProjectFile(record)).size);
});

it("takes an image that fits in 64 MB and refuses one that crosses it", () => {
  const record = recordWith(30 * MB);
  expect(fitsWithImage(record, 17 * MB)).toBe(true);
  expect(fitsWithImage(record, 18 * MB)).toBe(false);
});

it("refuses to move a project file already past 64 MB into this browser", async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array(64 * MB + 1)));
  vi.stubGlobal("fetch", fetch);
  await expect(moveToBrowser("p1", "Big plate")).rejects.toThrow(
    '"Big plate" is over the 64 MB project file limit, so it could not open from this browser.',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not upload an image the open browser project refuses", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  watchProject({
    id: "t1",
    onDocument: () => {},
    onMissing: () => {},
    checkImage: async () => {
      throw new Error("too big");
    },
  });
  await expect(
    api.uploadImage("t1", new File([new Uint8Array(4)], "a.png")),
  ).rejects.toThrow("too big");
  expect(fetch).not.toHaveBeenCalled();
});
