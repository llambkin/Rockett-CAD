import { useShallow } from "zustand/react/shallow";
import {
  downloadExport,
  exportBodyIds,
  exportCommand,
} from "../commands/export";
import { useEffect, useState } from "react";
import type { ExportFormat } from "@rockett/shared";
import { formatLength } from "@rockett/shared";
import { api } from "../api";
import { useSetting } from "../settings";
import { selectionKey, useStore } from "../store";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { SelInfo } from "./form/fields";

export function ExportPanel({ onClose }: { onClose: () => void }) {
  const units = useSetting("units.length");
  const document_ = useStore((s) => s.document);
  const selection = useStore((s) => s.selection);
  const setError = useStore((s) => s.setError);
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

  const bodyIds = useStore(useShallow(exportBodyIds));

  const doExport = async () => {
    if (!document_ || !format) return;
    setPending(true);
    try {
      await downloadExport(document_.id, { format, bodyIds, quality }, onClose);
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel id="design.export" title="Export for 3D printing">
      <div className="dialog-body">
        <SelInfo
          label="Bodies"
          input="bodies"
          picks={selection.filter((pick) => pick.kind === "body")}
          onRemove={(keys) =>
            useStore
              .getState()
              .setSelection(
                selection.filter((pick) => !keys.includes(selectionKey(pick))),
              )
          }
          hint={`all visible (${bodyIds.length})`}
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
        onCancel={exportCommand.exit}
        pending={pending}
        okDisabled={!format}
        okLabel={pending ? "Exporting…" : "Download"}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}
