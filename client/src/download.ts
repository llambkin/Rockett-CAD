import { formatSize, MODULE_DATA_MAX_BYTES } from "@rockett/shared";

export interface Download {
  blob: Blob;
  fileName: string | undefined;
}

export function saveDownload({ blob, fileName }: Download): void {
  const a = window.document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName ?? "";
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function readTextFile(
  file: File,
  maxBytes: number,
  limit: string,
): Promise<string> {
  if (file.size > maxBytes)
    throw new Error(
      `This file is over the ${formatSize(maxBytes, true)} ${limit} limit.`,
    );
  return file.text();
}

export async function pickFile({
  accept,
  maxBytes,
}: {
  accept: string;
  maxBytes: number;
}): Promise<{ name: string; text: string } | null> {
  if (!(maxBytes > 0)) throw new Error("maxBytes must be above 0.");
  const input = window.document.createElement("input");
  input.type = "file";
  input.accept = accept;
  const file = await new Promise<File | null>((resolve) => {
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
  if (!file) return null;
  const cap = Math.min(maxBytes, MODULE_DATA_MAX_BYTES);
  return { name: file.name, text: await readTextFile(file, cap, "file") };
}
