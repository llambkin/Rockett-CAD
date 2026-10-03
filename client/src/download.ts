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
