import { useContext } from "react";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  findOffsetConnector,
  formatLength,
  offsetSketchSelection,
  curveSamples,
  sketchCurves,
  type SketchFeature,
  type SketchEntity,
  type PlaneFrame,
  editSketchOffset,
} from "@rockett/shared";
import { useStore } from "../store";
import type { SketchState } from "../commands/sketch";
import { useSetting } from "../settings";
import { ViewportContext } from "../viewportRef";
import { uv3, type CadViewport } from "../three/CadViewport";
import { themeColor } from "../theme/tokens";
import { SKETCH_APPEARANCE } from "../tunables";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { LengthField } from "./form/fields";

export function SketchOffset() {
  const sketch = useStore((s) =>
    s.active?.id === "design.sketch" ? s.active.state : null,
  );
  return sketch && <SketchOffsetPanel sketch={sketch} />;
}

export function useSketchPreview(
  layerName: string,
  result: PreviewResult | null,
  editingIds?: readonly string[],
) {
  const viewport = useContext(ViewportContext);
  const draft = useStore((s) => s.draftSketch);
  const evaluation = useStore((s) => s.evaluation);
  useEffect(() => {
    const vp = viewport.current;
    const frame = evaluation?.sketches.find(
      (s) => s.featureId === draft?.id,
    )?.frame;
    if (!vp || !frame || !result || !draft) return;
    const layer = vp.addLayer(layerName);
    layer.group.add(offsetPreviewGroup(result, draft, frame, vp, editingIds));
    vp.requestRender();
    return () => {
      layer.dispose();
      vp.requestRender();
    };
  }, [layerName, result, draft, evaluation, editingIds, viewport]);
}

function selectConnector(sketchId: string, entityId: string) {
  const s = useStore.getState();
  s.setSketchState({ offsetManualSelection: true });
  s.toggleSelection({ kind: "sketchEntity", sketchId, entityId }, true);
}

const close = () => useStore.getState().setSketchTool("select");

function SketchOffsetPanel({ sketch }: { sketch: SketchState }) {
  const units = useSetting("units.length");
  const draft = useStore((s) => s.draftSketch);
  const selection = useStore((s) => s.selection);
  const busy = useStore((s) => s.busy);
  const setParams = useStore((s) => s.setSketchState);
  const editing = draft?.offsets?.find((o) => o.id === sketch.offsetEditId);
  const ids = useMemo(
    () =>
      selection.flatMap((s) =>
        s.kind === "sketchEntity" && s.sketchId === draft?.id
          ? [s.entityId]
          : [],
      ),
    [selection, draft?.id],
  );
  const manual = sketch.offsetManualSelection || ids.length > 1;
  const amount = sketch.offsetDistance;
  const chain = sketch.offsetChain;
  const joinTolerance = sketch.offsetJoinTolerance;
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

  useSketchPreview("sketchOffsetPreview", preview.result, editing?.entityIds);

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
    <DraggablePanel
      id="sketch.offset"
      title={editing ? "Edit offset" : "Offset sketch"}
    >
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
          units={units}
          step={0.5}
          ariaLabel="Offset distance"
          autoFocus
          value={amount}
          onChange={(v) => setParams({ offsetDistance: v })}
        />
        <button
          className="btn"
          onClick={() => setParams({ offsetDistance: -amount })}
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
            units={units}
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
            {formatLength(preview.result.joinedGaps.maxDistance, units)}, in the
            offset copy. Original sketch unchanged.
          </p>
        )}
        {preview.result?.offsetChain && (
          <p className="field-hint">
            {preview.result.offsetChain.closed
              ? "Closed outline, ready to offset."
              : `Open chain: orange crosses mark ends ${formatLength(preview.result.offsetChain.endGap, units)} apart. Select the missing side to make a closed outline.`}
          </p>
        )}
        {connector && (
          <button
            className="btn"
            onClick={() => selectConnector(draft!.id, connector)}
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

type PreviewResult = {
  entities: readonly SketchEntity[];
  offsetChain?: ReturnType<typeof offsetSketchSelection>["offsetChain"];
};

function offsetPreviewGroup(
  result: PreviewResult,
  draft: SketchFeature,
  frame: PlaneFrame,
  vp: CadViewport,
  editingIds?: readonly string[],
) {
  const group = new THREE.Group();
  const original = new Set(draft.entities.map((e) => e.id));
  if (editingIds) for (const id of editingIds) original.delete(id);
  for (const curve of sketchCurves(result.entities, true)) {
    if (original.has(curve.id)) continue;
    const coords = curveSamples(curve, 96);
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < coords.length; i += 2)
      positions.push(uv3(frame, coords[i]!, coords[i + 1]!));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(positions),
      new THREE.LineBasicMaterial({
        color: themeColor("offset"),
        depthTest: false,
        transparent: true,
        opacity: SKETCH_APPEARANCE.previewLineOpacity,
      }),
    );
    line.renderOrder = 9;
    group.add(line);
  }
  if (result.offsetChain && !result.offsetChain.closed) {
    const positions: THREE.Vector3[] = [],
      size = vp.worldPerPixel() * 6;
    for (const p of result.offsetChain.ends) {
      positions.push(
        uv3(frame, p.x - size, p.y),
        uv3(frame, p.x + size, p.y),
        uv3(frame, p.x, p.y - size),
        uv3(frame, p.x, p.y + size),
      );
    }
    const markers = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(positions),
      new THREE.LineBasicMaterial({
        color: themeColor("offset-end"),
        depthTest: false,
      }),
    );
    markers.renderOrder = 10;
    group.add(markers);
  }
  return group;
}
