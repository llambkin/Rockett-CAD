import { useEffect, useRef, useState } from "react";
import type { CadDocument, Feature } from "@rockett/shared";
import { featurePatch, useStore } from "../store";
import {
  takesAxis,
  featureParams,
  setFeatureParams,
} from "../commands/featureCommand";
import { createLivePreview } from "../livePreview";
import { DraggablePanel } from "./DraggablePanel";
import { RefRepair } from "./RefRepair";
import { DialogFooter } from "./form/DialogFooter";
import { SizeLimitHint } from "./form/SizeLimitHint";
import { featureUI, type DialogFeatureUI } from "../features/registry";
import { axisMissing, axisPicks } from "../features/inputs";
import { nextBindings, saveBound } from "../features/bindings";

function attempt(build: (() => Feature) | null): Feature | null {
  try {
    return build?.() ?? null;
  } catch {
    return null;
  }
}

const picked = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "sig" ? undefined : v));

export function featureChanges(
  stored: Feature | undefined,
  patch: Partial<Feature>,
) {
  const was: Record<string, unknown> = { targets: [], ...stored };
  return Object.entries({ targets: [], body: undefined, ...patch }).some(
    ([k, v]) => picked(was[k]) !== picked(v),
  );
}

function useLivePreview(editId: string | undefined, draft: Feature | null) {
  const key = draft && JSON.stringify(featurePatch(draft));
  const sent = useRef(editId ? key : null);
  const [live] = useState(() =>
    createLivePreview<Feature>({
      send: async (_id, feature) => {
        const patch = featurePatch(feature);
        sent.current = JSON.stringify(patch);
        const s = useStore.getState();
        if (!editId) return s.previewNewFeature(feature);
        const stored = s.document?.features.find((f) => f.id === editId);
        if (featureChanges(stored, patch))
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

function useStoredFeature(
  document: CadDocument | null,
  id: string | undefined,
) {
  const snapshot = () => ({
    revision: document?.revision,
    feature: document?.features.find((f) => f.id === id),
  });
  const [stored, setStored] = useState(snapshot);
  if (stored.revision !== document?.revision) setStored(snapshot());
  return stored.feature;
}

export function FeatureDialog() {
  const active = useStore((s) => s.active);
  if (active?.id !== "design.feature") return null;
  const ui = featureUI(active.state.type);
  if (!ui?.prefill) return null;
  return (
    <DialogBody
      key={active.state.type + (active.state.editFeatureId ?? "")}
      ui={ui}
      editId={active.state.editFeatureId}
    />
  );
}

function DialogBody({
  ui,
  editId,
}: {
  ui: DialogFeatureUI;
  editId?: string | undefined;
}) {
  const dialog = ui.type;
  const selection = useStore((s) => s.selection);
  const inputs = useStore((s) =>
    s.active?.id === "design.feature" ? s.active.state.inputs : undefined,
  );
  const params = useStore(featureParams);
  const setMode = useStore((s) => s.setMode);
  const cancel = useStore((s) => s.cancelDialog);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const setError = useStore((s) => s.setError);
  const document = useStore((s) => s.document);
  const stored = useStoredFeature(document, editId);
  const [pending, setPending] = useState(false);

  const axisDialog = takesAxis(dialog, params);
  const axisPicked = axisPicks(selection, document).length > 0;
  useEffect(() => {
    if (axisDialog && axisPicked && params.axisSource !== "edge")
      setFeatureParams({ axisSource: "edge" });
  }, [axisPicked, dialog]);
  const originAxis = selection.findLast((s) => s.kind === "axis")?.axis;
  useEffect(() => {
    if (axisDialog && originAxis)
      setFeatureParams({ axisSource: "origin", axis: originAxis });
  }, [originAxis, dialog]);

  const close = () => setMode({ name: "idle" });

  useEffect(() => {
    const patch = inputs?.onParamsChange();
    if (patch) setFeatureParams(patch);
  }, [dialog, selection, params]);

  const build =
    ui.hasBuild && inputs
      ? (): Feature => {
          const built = inputs.build(selection);
          if (!built) throw new Error("Feature has no builder");
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
  const update = async (patch: Partial<Feature>) => {
    if (featureChanges(stored, patch)) await updateFeature(editId!, patch);
  };
  const props = { editId, onClose: close, cancelPreview: live.cancel, update };
  if (ui.hasPanel) return inputs?.renderPanel(props, setFeatureParams);

  const ok = async () => {
    let feature: Feature;
    try {
      feature = build!();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    live.cancel();
    setPending(true);
    const bindings =
      document && nextBindings(document, feature, params.expressions);
    try {
      if (bindings)
        await saveBound(feature, editId, featurePatch(feature), bindings);
      else if (editId) await update(featurePatch(feature));
      else await addFeature(feature);
      close();
    } catch {
      return;
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel title={ui.title}>
      <div className="dialog-body">
        <RefRepair />
        {inputs?.renderForm(setFeatureParams)}
        <SizeLimitHint draft={draft} />
      </div>
      <DialogFooter
        onOk={() => void ok()}
        onCancel={cancel}
        pending={pending}
        okDisabled={
          !!params.invalid?.length ||
          (axisDialog && axisMissing(params, selection, document))
        }
        escapeAnywhere
      />
    </DraggablePanel>
  );
}
