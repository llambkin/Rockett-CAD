/**
 * Contextual feature panel (right side): parameter forms for each operation.
 * Flow: select geometry → enter parameters → OK commits the parametric
 * feature through the API.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat, Feature } from "@rockett/shared";
import { formatLength } from "@rockett/shared";
import { featurePatch, useStore, type DialogType } from "../store";
import { api, saveDownload } from "../api";
import { takes } from "../dialogPicks";
import { createLivePreview } from "../livePreview";
import { DraggablePanel } from "./DraggablePanel";
import { RefRepair } from "./RefRepair";
import { SelInfo } from "./form/fields";
import { DialogFooter } from "./form/DialogFooter";
import "../features/core";
import { SizeLimitHint } from "./form/SizeLimitHint";
import { featureUI } from "../features/registry";
import { axisMissing, axisPicks } from "../features/inputs";
import { useSetting } from "../settings";

function attempt(build: (() => Feature) | null): Feature | null {
  try {
    return build?.() ?? null;
  } catch {
    return null;
  }
}

const picked = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "sig" ? undefined : v));

function changes(stored: Feature | undefined, patch: Partial<Feature>) {
  const was: Record<string, unknown> = { targets: [], ...stored };
  return Object.entries({ targets: [], ...patch }).some(
    ([k, v]) => picked(was[k]) !== picked(v),
  );
}

function useLivePreview(editId: string | undefined, draft: Feature | null) {
  const key = draft && JSON.stringify(featurePatch(draft));
  const sent = useRef(editId ? key : null);
  const [live] = useState(() =>
    createLivePreview({
      send: async (_id, feature) => {
        const patch = featurePatch(feature as Feature);
        sent.current = JSON.stringify(patch);
        const s = useStore.getState();
        if (!editId) return s.previewNewFeature(feature as Feature);
        const stored = s.document?.features.find((f) => f.id === editId);
        if (changes(stored, patch))
          return s.updateFeaturePreview(editId, patch);
      },
    }),
  );
  useEffect(() => {
    if (draft && key !== sent.current) live.dwell(draft.id, draft);
    else live.cancel();
  }, [key]);
  useEffect(() => live.cancel, [live]);
  return live;
}

export function FeatureDialog() {
  const mode = useStore((s) => s.mode);
  if (mode.name !== "dialog") return null;
  return (
    <DialogBody
      key={mode.dialog + (mode.editFeatureId ?? "")}
      dialog={mode.dialog}
      editId={mode.editFeatureId}
    />
  );
}

function DialogBody({
  dialog,
  editId,
}: {
  dialog: DialogType;
  editId?: string | undefined;
}) {
  const selection = useStore((s) => s.selection);
  const params = useStore((s) => s.dialogParams);
  const setParams = useStore((s) => s.setDialogParams);
  const setMode = useStore((s) => s.setMode);
  const cancel = useStore((s) => s.cancelDialog);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const setError = useStore((s) => s.setError);
  const document_ = useStore((s) => s.document);
  const [stored] = useState(() =>
    document_?.features.find((f) => f.id === editId),
  );
  const [pending, setPending] = useState(false);

  // Picking an edge or sketch line in an axis-based dialog switches the axis
  // to it — the dropdown alone gave no hint the pick was registered.
  const axisDialog =
    dialog === "constructionPlane"
      ? params.method === "angle"
      : takes(dialog, "axis");
  const axisPicked = axisPicks(selection, document_).length > 0;
  useEffect(() => {
    if (axisDialog && axisPicked && params.axisSource !== "edge")
      setParams({ axisSource: "edge" });
  }, [axisPicked, dialog]);
  const originAxis = selection.findLast((s) => s.kind === "axis")?.axis;
  useEffect(() => {
    if (axisDialog && originAxis)
      setParams({ axisSource: "origin", axis: originAxis });
  }, [originAxis, dialog]);

  const noAxis = axisDialog && axisMissing(params, selection, document_);
  const close = () => setMode({ name: "idle" });

  const ui = featureUI(dialog);
  useEffect(() => {
    const patch = ui?.onParamsChange?.(params);
    if (patch) setParams(patch);
  }, [dialog, selection, params]);

  const uiBuild = ui?.build;
  const build = uiBuild
    ? (): Feature => {
        const built = uiBuild(params, selection);
        if ("error" in built) throw new Error(built.error);
        return built;
      }
    : null;

  const draft = attempt(build);
  const live = useLivePreview(editId, draft);
  useEffect(
    () => () => {
      void useStore.getState().cancelPreview();
    },
    [],
  );
  if (ui?.Panel)
    return (
      <ui.Panel editId={editId} onClose={close} cancelPreview={live.cancel} />
    );
  if (dialog === "export") return <ExportPanel onClose={close} />;

  const ok = async () => {
    let feature: Feature;
    try {
      feature = build!();
    } catch (e: any) {
      setError(e.message);
      return;
    }
    live.cancel();
    if (editId && !changes(stored, featurePatch(feature))) return close();
    setPending(true);
    try {
      if (editId) await updateFeature(editId, featurePatch(feature));
      else await addFeature(feature);
      close();
    } catch {
      // error toast already set by store
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel title={ui?.title ?? ""}>
      <div className="dialog-body">
        <RefRepair />
        {ui?.Form && <ui.Form params={params} setParams={setParams} />}
        <SizeLimitHint draft={draft} />
      </div>
      <DialogFooter
        onOk={() => void ok()}
        onCancel={cancel}
        pending={pending}
        okDisabled={noAxis}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}

// ---------------------------------------------------------------------------
// Export panel
// ---------------------------------------------------------------------------

function ExportPanel({ onClose }: { onClose: () => void }) {
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
