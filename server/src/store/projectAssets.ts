import { MB } from "@rockett/shared";
import { StoreError } from "./jsonStore.js";
import { isPng } from "./thumbnailStore.js";

export const IMAGE_LIMIT_MB = 25;

export const IMAGE_TYPES: Array<{
  mime: string;
  test: (b: Buffer) => boolean;
}> = [
  {
    mime: "image/png",
    test: isPng,
  },
  {
    mime: "image/jpeg",
    test: (b) =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

export function imageMime(data: Buffer, label: string): string {
  if (data.length > IMAGE_LIMIT_MB * MB)
    throw new StoreError(`${label}image is over ${IMAGE_LIMIT_MB} MB`);
  const type = IMAGE_TYPES.find((t) => t.test(data));
  if (!type)
    throw new StoreError(
      `${label}unsupported image type (PNG, JPEG, WebP only)`,
    );
  return type.mime;
}
