import { useRef } from "react";
import { importDxf, importSvg } from "@rockett/shared";
import { useStore } from "../store";
import { INSERT_SVG_NEEDS_PLANE, insertPlaneFor } from "../sketchImport";
import { alignCameraToActiveSketch } from "../viewportRef";

const SKETCH_INSERTS = [
  {
    format: "DXF",
    accept: ".dxf",
    read: importDxf,
    title:
      "Insert lines, arcs, circles, points and polylines from an ASCII DXF file",
  },
  {
    format: "SVG",
    accept: ".svg",
    read: importSvg,
    title:
      "Insert paths, lines, polylines, polygons, rectangles and circles from an SVG file",
  },
];

function FileButton({
  format,
  accept,
  title,
  onText,
  canOpen = () => true,
}: {
  format: string;
  accept: string;
  title: string;
  onText: (text: string) => Promise<void> | void;
  canOpen?: () => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useStore((s) => s.busy);
  const load = async (file?: File) => {
    if (!file) return;
    try {
      await onText(await file.text());
    } catch (error) {
      useStore.getState().setError((error as Error).message);
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-label={`${format} file`}
        onChange={(e) => void load(e.target.files?.[0])}
      />
      <button
        className="tb-btn"
        disabled={busy}
        title={title}
        onClick={() => canOpen() && input.current?.click()}
      >
        Insert {format}
      </button>
    </>
  );
}

export function SketchInsertButtons() {
  return SKETCH_INSERTS.map(({ format, accept, read, title }) => (
    <FileButton
      key={format}
      format={format}
      accept={accept}
      title={title}
      onText={(text) =>
        useStore.getState().beginSketchImport(format, read(text), false)
      }
    />
  ));
}

export function InsertSvgOnFaceButton() {
  return (
    <FileButton
      format="SVG"
      accept=".svg"
      title="Insert SVG: select a planar face or plane, then place an SVG drawing on it as a sketch"
      canOpen={() => {
        const s = useStore.getState();
        if (insertPlaneFor(s.selection, s.evaluation)) return true;
        s.setError(INSERT_SVG_NEEDS_PLANE);
        return false;
      }}
      onText={async (text) => {
        await useStore.getState().insertSvgOnSelection(importSvg(text));
        alignCameraToActiveSketch();
      }}
    />
  );
}
