import path from "node:path";
import { THUMBNAIL_LIMITS } from "@rockett/shared";
import { sha256, StoreError } from "./jsonStore.js";
import type { Storage } from "./storage.js";

const FILE = "thumbnail.png";
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const { width, height, bytes } = THUMBNAIL_LIMITS;

export const THUMBNAIL_RULE = `A snapshot is one PNG of at most ${width}x${height} pixels and ${bytes / 1024} KB.`;

export const isPng = (b: Buffer) =>
  b.length >= 33 && b.subarray(0, 16).equals(PNG_HEAD);

const tag = (data: Buffer) => `"${sha256(data)}"`;

function thumbnailPng(data: unknown): Buffer {
  if (Buffer.isBuffer(data) && data.length <= bytes && isPng(data)) {
    const w = data.readUInt32BE(16);
    const h = data.readUInt32BE(20);
    if (w >= 1 && h >= 1 && w <= width && h <= height) return data;
  }
  throw new StoreError(THUMBNAIL_RULE);
}

export class ThumbnailStore {
  constructor(
    private readonly storage: Storage,
    private readonly projectDir: (projectId: string) => string,
    private readonly exclusive: (
      projectId: string,
      operation: () => Promise<void>,
    ) => Promise<void>,
  ) {}

  private file(projectId: string): string {
    return path.posix.join(this.projectDir(projectId), FILE);
  }

  async read(projectId: string): Promise<{ data: Buffer; tag: string }> {
    const data = await this.storage.read(this.file(projectId)).catch(() => {
      throw new StoreError("no snapshot yet", "not_found");
    });
    return { data, tag: tag(data) };
  }

  async write(projectId: string, body: unknown): Promise<string> {
    const data = thumbnailPng(body);
    await this.exclusive(projectId, () =>
      this.storage.writeAtomic(this.file(projectId), data),
    );
    return tag(data);
  }
}
