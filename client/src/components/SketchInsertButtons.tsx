import { useRef } from "react";
import { importDxf, importSvg } from "@rockett/shared";
import { useStore } from "../store";

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

function InsertButton({
  format,
  accept,
  read,
  title,
}: (typeof SKETCH_INSERTS)[number]) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useStore((s) => s.busy);
  const load = async (file?: File) => {
    if (!file) return;
    const s = useStore.getState();
    try {
      await s.insertSketchImport(format, read(await file.text()));
    } catch (error) {
      s.setError((error as Error).message);
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
        onClick={() => input.current?.click()}
      >
        Insert {format}
      </button>
    </>
  );
}

export function SketchInsertButtons() {
  return SKETCH_INSERTS.map((insert) => (
    <InsertButton key={insert.format} {...insert} />
  ));
}
