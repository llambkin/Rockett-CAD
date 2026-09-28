import { useEffect, useMemo, useState } from "react";
import type { ExportFormat } from "@rockett/shared";
import { formatLength } from "@rockett/shared";
import { api, saveDownload } from "../api";
import { useSetting } from "../settings";
import { useStore } from "../store";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { SelInfo } from "./form/fields";

export function ExportPanel() {
  const open = useStore(
    (s) => s.mode.name === "dialog" && s.mode.dialog === "export",
  );
  const setMode = useStore((s) => s.setMode);
  if (!open) return null;
  return <ExportBody onClose={() => setMode({ name: "idle" })} />;
}

function ExportBody({ onClose }: { onClose: () => void }) {
  const units = useSetting("units.length");
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const hiddenBodies = useStore((s) => s.view.hidden.bodies);
  const selection = useStore((s) => s.selection);
  const setError = useStore((s) => s.setError);
  const cancel = useStore((s) => s.cancelDialog);
  const [exporters, setExporters] = useState<ExportFormat[]>([]);
  const [picked, setFormat] = useState("");
  const format = picked || exporters[0]?.format;
  const [quality, setQuality] = useState(0.05);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.formats().then(
      (formats) =>
        setExporters(formats.exporters.filter((e) => e.source === "bodies")),
      (e: Error) => setError(e.message),
    );
  }, [setError]);

  const selectedBodies = useMemo(
    () => selection.filter((s) => s.kind === "body").map((s: any) => s.bodyId),
    [selection],
  );
  const shownBodies = useMemo(() => {
    const hidden = new Set(hiddenBodies);
    return (evaluation?.bodies ?? [])
      .filter((b) => !hidden.has(b.bodyId))
      .map((b) => b.bodyId);
  }, [evaluation, hiddenBodies]);

  const doExport = async () => {
    if (!document_ || !format) return;
    setPending(true);
    try {
      saveDownload(
        await api.exportModel(document_.id, {
          format,
          bodyIds: selectedBodies.length > 0 ? selectedBodies : shownBodies,
          quality,
        }),
      );
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel title="Export for 3D printing">
      <div className="dialog-body">
        <SelInfo
          label="Bodies"
          input="bodies"
          hint={`all visible (${shownBodies.length})`}
        />
        <label className="field">
          <span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {exporters.map((e) => (
              <option key={e.format} value={e.format}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Quality ({units} deviation)</span>
          <select
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
          >
            <option value={0.1}>Draft ({formatLength(0.1, units)})</option>
            <option value={0.05}>Standard ({formatLength(0.05, units)})</option>
            <option value={0.01}>Fine ({formatLength(0.01, units)})</option>
          </select>
        </label>
      </div>
      <DialogFooter
        onOk={() => void doExport()}
        onCancel={cancel}
        pending={pending}
        okDisabled={!format}
        okLabel={pending ? "Exporting…" : "Download"}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}
