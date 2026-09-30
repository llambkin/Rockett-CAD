import { saveDownload, type Download } from "../download";

export type Point = { x: number; y: number };

export interface RowAction {
  label: string;
  glyph: string;
  title?: string;
  danger?: boolean;
  run: (at: Point) => void;
}

export type Run = (work: Promise<unknown>) => void;

export const deleteAction = (
  name: string,
  run: Run,
  remove: () => Promise<unknown>,
): RowAction => ({
  label: "Delete",
  glyph: "✕",
  danger: true,
  run: () => {
    if (window.confirm(`Delete project "${name}"?`)) run(remove());
  },
});

export function projectActions(
  name: string,
  run: Run,
  ops: {
    rename: () => void;
    duplicate: () => Promise<unknown>;
    download: () => Promise<Download>;
    remove: () => Promise<unknown>;
  },
  moveTo: RowAction[] = [],
): RowAction[] {
  return [
    { label: "Rename", glyph: "✎", run: ops.rename },
    { label: "Duplicate", glyph: "⎘", run: () => run(ops.duplicate()) },
    {
      label: "Download",
      glyph: "⤓",
      title: "Download project file",
      run: () => run(ops.download().then(saveDownload)),
    },
    ...moveTo,
    deleteAction(name, run, ops.remove),
  ];
}
