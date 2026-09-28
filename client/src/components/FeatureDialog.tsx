/**
 * Contextual feature panel (right side): parameter forms for each operation.
 * Flow: select geometry → enter parameters → OK commits the parametric
 * feature through the API.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type {
  AxisRef,
  EdgeRef,
  ExportFormat,
  FaceRef,
  Feature,
  ProfileRef,
} from "@rockett/shared";
import { formatLength, newId } from "@rockett/shared";
import {
  featurePatch,
  useStore,
  type DialogType,
  type Selection,
} from "../store";
import { api, saveDownload } from "../api";
import { extrudeOperation } from "../extrudeReach";
import { clearInput, takes } from "../dialogPicks";
import { createLivePreview } from "../livePreview";
import { toolTargets } from "../toolTargets";
import { DraggablePanel } from "./DraggablePanel";
import { RefRepair } from "./RefRepair";
import {
  AxisField,
  LengthField,
  NumField,
  SelInfo,
  SelectField,
  TargetField,
} from "./form/fields";
import { DialogFooter } from "./form/DialogFooter";
import "../features/core";
import { SizeLimitHint } from "./form/SizeLimitHint";
import { featureUI } from "../features/registry";
import { axisHint } from "../features/inputs";
import { useSetting } from "../settings";

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

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
  const units = useSetting("units.length");
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

  const profiles = selection.filter((s) => s.kind === "profile") as Extract<
    Selection,
    { kind: "profile" }
  >[];
  const edges = selection.filter((s) => s.kind === "edge") as Extract<
    Selection,
    { kind: "edge" }
  >[];
  const faces = selection.filter((s) => s.kind === "face") as Extract<
    Selection,
    { kind: "face" }
  >[];
  // selected sketch LINES (axis candidates for revolve / circular pattern)
  const sketchLines = (
    selection.filter((s) => s.kind === "sketchEntity") as any[]
  ).filter((s) => {
    const sk = document_?.features.find(
      (f) => f.id === s.sketchId && f.type === "sketch",
    ) as any;
    return sk?.entities.find((x: any) => x.id === s.entityId)?.kind === "line";
  });

  const p = (key: string, dflt: any) => params[key] ?? dflt;
  const num = (key: string, dflt: number) => {
    const v = Number(params[key]);
    return Number.isFinite(v) ? v : dflt;
  };

  // Picking an edge or sketch line in an axis-based dialog switches the axis
  // to it — the dropdown alone gave no hint the pick was registered.
  const axisDialog =
    dialog === "constructionPlane"
      ? params.method === "angle"
      : takes(dialog, "axis");
  useEffect(() => {
    if (!axisDialog) return;
    if (
      (edges.length > 0 || sketchLines.length > 0) &&
      params.axisSource !== "edge"
    ) {
      setParams({ axisSource: "edge" });
    }
  }, [edges.length, sketchLines.length, dialog]);
  const originAxis = selection.findLast((s) => s.kind === "axis")?.axis;
  useEffect(() => {
    if (axisDialog && originAxis)
      setParams({ axisSource: "origin", axis: originAxis });
  }, [originAxis, dialog]);

  const profileRefs = (): ProfileRef[] =>
    profiles.map((x) => ({ sketchId: x.sketchId, profileId: x.profileId }));
  const edgeRefs = (): EdgeRef[] =>
    edges.map((x) => ({
      kind: "edge",
      bodyId: x.bodyId,
      edgeName: x.edgeName,
    }));
  const faceRefs = (): FaceRef[] =>
    faces.map((x) => ({
      kind: "face",
      bodyId: x.bodyId,
      faceName: x.faceName,
    }));
  const storedFeature = () =>
    document_?.features.find((f) => f.id === editId) ?? {};
  const profileSources = () => {
    need(
      profiles.length + faces.length > 0,
      "Select at least one profile or planar face",
    );
    return {
      profiles: profileRefs(),
      ...((faces.length > 0 || "faces" in storedFeature()) && {
        faces: faceRefs(),
      }),
    };
  };
  const axisMissing =
    axisDialog &&
    p("axisSource", "origin") === "edge" &&
    edges.length + sketchLines.length === 0;
  const chooseAxis = (key: string, patch: Record<string, unknown>) => {
    setParams(patch);
    clearInput(key);
  };
  const axisRef = (): AxisRef => {
    if (p("axisSource", "origin") !== "edge")
      return { kind: "originAxis", axis: p("axis", "Z") };
    need(!axisMissing, "Pick an axis");
    const line = sketchLines[0];
    return line
      ? { kind: "sketchLine", sketchId: line.sketchId, entityId: line.entityId }
      : { kind: "edge", edge: edgeRefs()[0]! };
  };

  const close = () => setMode({ name: "idle" });

  const targets = (operation: string) =>
    toolTargets(operation, params.targets, document_?.namingVersion);
  const operationField = (intersect: boolean, extra: object = {}) => (
    <>
      <SelectField
        label="Operation"
        value={p("operation", "join")}
        options={[
          ["newBody", "New body"],
          ["join", "Join"],
          ["cut", "Cut"],
          ...(intersect
            ? [["intersect", "Intersect"] as [string, string]]
            : []),
        ]}
        onChange={(v) => setParams({ operation: v, ...extra })}
      />
      <TargetField operation={p("operation", "join")} />
    </>
  );

  useEffect(() => {
    if (dialog !== "extrude" || num("distance", 10) === 0) return;
    if (params.operation !== undefined && !params.autoOperation) return;
    const operation = extrudeOperation(
      p("direction", "normal"),
      num("distance", 10),
      num("startOffset", 0),
      num("distance2", 5),
    );
    if (operation !== params.operation)
      setParams({ operation, autoOperation: true });
  }, [dialog, selection, params]);

  let title = "";
  let body: ReactElement | null = null;
  let build: (() => Feature) | null = null;
  let panel: ReactElement | null = null;

  const ui = featureUI(dialog);
  if (ui?.Form) {
    title = ui.title;
    body = <ui.Form params={params} setParams={setParams} />;
  }
  const uiBuild = ui?.build;
  if (uiBuild)
    build = () => {
      const built = uiBuild(params, selection);
      if ("error" in built) throw new Error(built.error);
      return built;
    };
  switch (dialog) {
    case "extrude": {
      title = "Extrude";
      body = (
        <>
          <SelInfo
            label="Profiles / faces"
            input="profiles"
            hint="click sketch regions or planar faces"
          />
          <LengthField
            label="Start offset"
            units={units}
            value={p("startOffset", 0)}
            onChange={(v) => setParams({ startOffset: v })}
          />
          <div className="field-hint">
            0 = start on the sketch / face; ± moves the start plane along its
            normal
          </div>
          <LengthField
            label="Distance"
            units={units}
            autoFocus
            value={p("distance", 10)}
            onChange={(v) => setParams({ distance: v })}
          />
          <div className="field-hint">
            Negative = the other side (Cut when it meets a body)
          </div>
          <SelectField
            label="Direction"
            value={p("direction", "normal")}
            options={[
              ["normal", "One side"],
              ["reverse", "Reversed"],
              ["symmetric", "Symmetric"],
              ["twoSided", "Two sided"],
            ]}
            onChange={(v) => setParams({ direction: v })}
          />
          {p("direction", "normal") === "twoSided" && (
            <LengthField
              label="Distance 2"
              units={units}
              value={p("distance2", 5)}
              onChange={(v) => setParams({ distance2: v })}
            />
          )}
          {operationField(true, { autoOperation: false })}
        </>
      );
      build = () => {
        const sources = profileSources();
        need(num("distance", 10) !== 0, "Extrude distance must be non-zero");
        const stored = storedFeature();
        const direction = p("direction", "normal");
        const startOffset = num("startOffset", 0);
        return {
          id: editId ?? newId("extrude"),
          type: "extrude",
          name: p("name", ""),
          suppressed: false,
          ...sources,
          distance: num("distance", 10),
          ...((direction === "twoSided" || "distance2" in stored) && {
            distance2: num("distance2", 5),
          }),
          ...((startOffset !== 0 || "startOffset" in stored) && {
            startOffset,
          }),
          direction,
          operation: p("operation", "join"),
          ...targets(p("operation", "join")),
        };
      };
      break;
    }
    case "revolve": {
      title = "Revolve";
      body = (
        <>
          <SelInfo
            label="Profiles / faces"
            input="profiles"
            hint="click sketch regions or Shift-click planar faces"
          />
          <SelInfo
            label="Axis"
            input="axis"
            picks={[...edges, ...sketchLines]}
            hint={axisHint(axisMissing)}
          />
          <AxisField
            axisSource={params.axisSource}
            axis={params.axis}
            onChange={(patch) => chooseAxis("axis", patch)}
          />
          <NumField
            label="Angle (°)"
            autoFocus
            value={p("angle", 360)}
            onChange={(v) => setParams({ angle: v })}
          />
          {operationField(true)}
        </>
      );
      build = () => {
        return {
          id: editId ?? newId("revolve"),
          type: "revolve",
          name: p("name", ""),
          suppressed: false,
          ...profileSources(),
          axis: axisRef(),
          angle: num("angle", 360),
          operation: p("operation", "join"),
          ...targets(p("operation", "join")),
        };
      };
      break;
    }
    case "export": {
      panel = <ExportPanel onClose={close} />;
      break;
    }
  }

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
  if (panel) return panel;

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
    <DraggablePanel title={title}>
      <div className="dialog-body">
        <RefRepair />
        {body}
        <SizeLimitHint draft={draft} />
      </div>
      <DialogFooter
        onOk={() => void ok()}
        onCancel={cancel}
        pending={pending}
        okDisabled={axisMissing}
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
