import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  findOffsetConnector,
  offsetSketchSelection,
  editSketchOffset,
} from "@rockett/shared";
import { useStore } from "../store";
import { viewportHandle } from "../viewportRef";
import { uv3 } from "../three/CadViewport";
import { disposeGroup } from "../three/dispose";
import { previewCurves } from "../three/sketchPreview";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { LengthField } from "./form/fields";

export function SketchOffsetPanel() {
  const mode = useStore((s) => s.mode);
  return mode.name === "sketch" && mode.tool === "offset" ? (
    <OffsetBody />
  ) : null;
}

function OffsetBody() {
  const draft = useStore((s) => s.draftSketch);
  const selection = useStore((s) => s.selection);
  const evaluation = useStore((s) => s.evaluation);
  const params = useStore((s) => s.dialogParams);
  const busy = useStore((s) => s.busy);
  const setParams = useStore((s) => s.setDialogParams);
  const editing = draft?.offsets?.find((o) => o.id === params.editOffsetId);
  const ids = useMemo(
    () =>
      selection.flatMap((s) =>
        s.kind === "sketchEntity" && s.sketchId === draft?.id
          ? [s.entityId]
          : [],
      ),
    [selection, draft?.id],
  );
  const manual = params.offsetManualSelection === true || ids.length > 1;
  const amount = Number(params.sketchOffset ?? 2);
  const chain = params.offsetChain !== false;
  const joinTolerance = Number(params.offsetJoinTolerance ?? 0.01);
  const preview = useMemo(() => {
    if (!draft || (!editing && !ids.length))
      return { result: null, error: null };
    try {
      return {
        result: editing
          ? {
              ...editSketchOffset(draft, editing.id, amount),
              removedConstraints: 0,
              offsetChain: undefined,
              joinedGaps: undefined,
            }
          : offsetSketchSelection(
              draft.entities,
              draft.constraints,
              ids,
              amount,
              chain && !manual,
              joinTolerance,
            ),
        error: null,
      };
    } catch (e) {
      return { result: null, error: (e as Error).message };
    }
  }, [draft, ids, amount, chain, manual, joinTolerance, editing]);
  const openChain = preview.result?.offsetChain;
  const connector =
    draft && openChain && !openChain.closed
      ? findOffsetConnector(draft.entities, ids, openChain.ends, joinTolerance)
      : null;

  useEffect(() => {
    const vp = viewportHandle.current;
    const frame = evaluation?.sketches.find(
      (s) => s.featureId === draft?.id,
    )?.frame;
    if (!vp || !frame || !preview.result || !draft) return;
    const original = new Set(draft.entities.map((e) => e.id));
    if (editing) for (const id of editing.entityIds) original.delete(id);
    const group = previewCurves(preview.result.entities, frame, original);
    if (preview.result.offsetChain && !preview.result.offsetChain.closed) {
      const positions: THREE.Vector3[] = [],
        size = vp.worldPerPixel() * 6;
      for (const p of preview.result.offsetChain.ends) {
        positions.push(
          uv3(frame, p.x - size, p.y),
          uv3(frame, p.x + size, p.y),
          uv3(frame, p.x, p.y - size),
          uv3(frame, p.x, p.y + size),
        );
      }
      const markers = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(positions),
        new THREE.LineBasicMaterial({ color: 0xff9933, depthTest: false }),
      );
      markers.renderOrder = 10;
      group.add(markers);
    }
    vp.scene.add(group);
    vp.requestRender();
    return () => {
      vp.scene.remove(group);
      disposeGroup(group);
      vp.requestRender();
    };
  }, [preview, draft, evaluation, editing]);

  const close = () => useStore.getState().setSketchTool("select");
  const apply = async () => {
    if (!preview.result || busy || !draft) return;
    const s = useStore.getState();
    try {
      if (editing) await s.editOffset(editing.id, amount);
      else await s.createOffset(ids, amount, chain && !manual, joinTolerance);
      if (!useStore.getState().error) close();
    } catch (e) {
      s.setError((e as Error).message);
    }
  };
  return (
    <DraggablePanel title={editing ? "Edit offset" : "Offset sketch"}>
      <div className="dialog-body">
        <p>
          {editing
            ? "Change the saved offset distance. Yellow previews the updated geometry."
            : ids.length
              ? `${ids.length} curve${ids.length === 1 ? "" : "s"} selected · Ctrl-click to add or remove curves`
              : "Select a curve. Hold Ctrl to choose the lines and arcs that make your chain."}
        </p>
        <LengthField
          label="Distance"
          units="mm"
          step={0.5}
          ariaLabel="Offset distance"
          autoFocus
          value={amount}
          onChange={(v) => setParams({ sketchOffset: v })}
        />
        <button
          className="btn"
          onClick={() => setParams({ sketchOffset: -amount })}
        >
          Reverse direction
        </button>
        {!editing &&
          (manual ? (
            <p className="field-hint">
              Offsets only your selected curves. A plain click starts a new
              selection.
            </p>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={chain}
                onChange={(e) => setParams({ offsetChain: e.target.checked })}
              />
              Automatically chain connected curves
            </label>
          ))}
        {!editing && manual && (
          <LengthField
            label="Join gaps up to"
            units="mm"
            min={0}
            max={1}
            step={0.001}
            ariaLabel="Offset join tolerance"
            value={joinTolerance}
            onChange={(v) => setParams({ offsetJoinTolerance: v })}
          />
        )}
        {preview.result?.joinedGaps && (
          <p className="field-hint">
            Joined {preview.result.joinedGaps.count} small gap(s), up to{" "}
            {Number(preview.result.joinedGaps.maxDistance.toFixed(6))} mm, in
            the offset copy. Original sketch unchanged.
          </p>
        )}
        {preview.result?.offsetChain && (
          <p className="field-hint">
            {preview.result.offsetChain.closed
              ? "Closed outline — ready to offset."
              : `Open chain — orange crosses mark ends ${Number(preview.result.offsetChain.endGap.toFixed(6))} mm apart. Select the missing side to make a closed outline.`}
          </p>
        )}
        {connector && (
          <button
            className="btn"
            onClick={() => {
              const s = useStore.getState();
              s.setDialogParams({ offsetManualSelection: true });
              s.toggleSelection(
                {
                  kind: "sketchEntity",
                  sketchId: draft!.id,
                  entityId: connector,
                },
                true,
              );
            }}
          >
            Select missing side
          </button>
        )}
        <p className="field-hint">
          Yellow shows the new geometry. Chaining follows lines and rounded
          corners. Positive is left of the selected line, or outside the
          selected circle/arc.
        </p>
        {preview.error && <p className="field-hint">{preview.error}</p>}
      </div>
      <DialogFooter
        onOk={() => void apply()}
        onCancel={close}
        pending={busy}
        okLabel={editing ? "Save offset" : "Create offset"}
        okDisabled={!preview.result}
      />
    </DraggablePanel>
  );
}
