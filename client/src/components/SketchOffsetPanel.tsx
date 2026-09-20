import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { findOffsetConnector, offsetSketchSelection, sampleArc, editSketchOffset } from "@rockett/shared";
import { useStore } from "../store";
import { viewportHandle } from "../viewportRef";
import { uv3 } from "../three/CadViewport";
import { DraggablePanel } from "./DraggablePanel";

export function SketchOffsetPanel() {
  const mode = useStore(s => s.mode);
  return mode.name === "sketch" && mode.tool === "offset" ? <OffsetBody /> : null;
}

function OffsetBody() {
  const draft = useStore(s => s.draftSketch);
  const selection = useStore(s => s.selection);
  const evaluation = useStore(s => s.evaluation);
  const params = useStore(s => s.dialogParams);
  const busy = useStore(s => s.busy);
  const setParams = useStore(s => s.setDialogParams);
  const editing = draft?.offsets?.find(o => o.id === params.editOffsetId);
  const ids = useMemo(() => selection.flatMap(s => s.kind === "sketchEntity" && s.sketchId === draft?.id ? [s.entityId] : []), [selection, draft?.id]);
  const manual = params.offsetManualSelection === true || ids.length > 1;
  const amount = Number(params.sketchOffset ?? 2);
  const chain = params.offsetChain !== false;
  const joinTolerance = Number(params.offsetJoinTolerance ?? 0.01);
  const preview = useMemo(() => {
    if (!draft || (!editing && !ids.length)) return { result: null, error: null };
    try { return { result: editing ? { ...editSketchOffset(draft, editing.id, amount), removedConstraints: 0, offsetChain: undefined, joinedGaps: undefined }
      : offsetSketchSelection(draft.entities, draft.constraints, ids, amount, chain && !manual, joinTolerance), error: null }; }
    catch (e) { return { result: null, error: (e as Error).message }; }
  }, [draft, ids, amount, chain, manual, joinTolerance, editing]);
  const openChain = preview.result?.offsetChain;
  const connector = draft && openChain && !openChain.closed ? findOffsetConnector(draft.entities, ids, openChain.ends, joinTolerance) : null;

  useEffect(() => {
    const vp = viewportHandle.current;
    const frame = evaluation?.sketches.find(s => s.featureId === draft?.id)?.frame;
    if (!vp || !frame || !preview.result || !draft) return;
    const group = new THREE.Group();
    const original = new Set(draft.entities.map(e => e.id));
    if (editing) for (const id of editing.entityIds) original.delete(id);
    const points = new Map(preview.result.entities.filter(e => e.kind === "point").map(e => [e.id, e]));
    for (const e of preview.result.entities) {
      if (original.has(e.id) || e.kind === "point") continue;
      let coords: number[] = [];
      if (e.kind === "line") {
        const a = points.get(e.p1)!, b = points.get(e.p2)!;
        coords = [a.x, a.y, b.x, b.y];
      } else if (e.kind === "circle") {
        const c = points.get(e.center)!;
        for (let i = 0; i <= 96; i++) coords.push(c.x + e.radius * Math.cos(i * Math.PI / 48), c.y + e.radius * Math.sin(i * Math.PI / 48));
      } else {
        const c = points.get(e.center)!, a = points.get(e.start)!, b = points.get(e.end)!;
        coords = sampleArc(c.x, c.y, a.x, a.y, b.x, b.y, 64);
      }
      const positions: THREE.Vector3[] = [];
      for (let i = 0; i < coords.length; i += 2) positions.push(uv3(frame, coords[i], coords[i + 1]));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions),
        new THREE.LineBasicMaterial({ color: 0xffcc66, depthTest: false, transparent: true, opacity: 0.9 }));
      line.renderOrder = 9;
      group.add(line);
    }
    if (preview.result.offsetChain && !preview.result.offsetChain.closed) {
      const positions: THREE.Vector3[] = [], size = vp.worldPerPixel() * 6;
      for (const p of preview.result.offsetChain.ends) {
        positions.push(uv3(frame, p.x - size, p.y), uv3(frame, p.x + size, p.y),
          uv3(frame, p.x, p.y - size), uv3(frame, p.x, p.y + size));
      }
      const markers = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(positions),
        new THREE.LineBasicMaterial({ color: 0xff9933, depthTest: false }));
      markers.renderOrder = 10; group.add(markers);
    }
    vp.scene.add(group);
    return () => { vp.scene.remove(group); for (const child of group.children) {
      const line = child as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
      line.geometry.dispose(); line.material.dispose();
    } };
  }, [preview, draft, evaluation, editing]);

  const close = () => useStore.getState().setSketchTool("select");
  const apply = async () => {
    if (!preview.result || busy || !draft) return;
    const s = useStore.getState();
    try {
      if (editing) await s.editOffset(editing.id, amount);
      else await s.createOffset(ids, amount, chain && !manual, joinTolerance);
      if (!useStore.getState().error) close();
    } catch (e) { s.setError((e as Error).message); }
  };
  return <DraggablePanel title={editing ? "Edit offset" : "Offset sketch"}>
    <div className="dialog-body">
      <p>{editing ? "Change the saved offset distance. Yellow previews the updated geometry." : ids.length ? `${ids.length} curve${ids.length === 1 ? "" : "s"} selected · Ctrl-click to add or remove curves` : "Select a curve. Hold Ctrl to choose the lines and arcs that make your chain."}</p>
      <label className="field">Distance (mm)<input type="number" step="0.5" aria-label="Offset distance" value={params.sketchOffset ?? 2}
        onChange={e => setParams({ sketchOffset: e.target.value })} /></label>
      <button className="btn" onClick={() => setParams({ sketchOffset: -amount })}>Reverse direction</button>
      {!editing && (manual ? <p className="field-hint">Offsets only your selected curves. A plain click starts a new selection.</p> :
        <label><input type="checkbox" checked={chain} onChange={e => setParams({ offsetChain: e.target.checked })} />Automatically chain connected curves</label>)}
      {!editing && manual && <label className="field">Join gaps up to (mm)<input type="number" min="0" max="1" step="0.001" aria-label="Offset join tolerance"
        value={params.offsetJoinTolerance ?? 0.01} onChange={e => setParams({ offsetJoinTolerance: e.target.value })} /></label>}
      {preview.result?.joinedGaps && <p className="field-hint">Joined {preview.result.joinedGaps.count} small gap(s), up to {Number(preview.result.joinedGaps.maxDistance.toFixed(6))} mm, in the offset copy. Original sketch unchanged.</p>}
      {preview.result?.offsetChain && <p className="field-hint">{preview.result.offsetChain.closed ? "Closed outline — ready to offset." :
        `Open chain — orange crosses mark ends ${Number(preview.result.offsetChain.endGap.toFixed(6))} mm apart. Select the missing side to make a closed outline.`}</p>}
      {connector && <button className="btn" onClick={() => {
        const s = useStore.getState(); s.setDialogParams({ offsetManualSelection: true });
        s.toggleSelection({ kind: "sketchEntity", sketchId: draft!.id, entityId: connector }, true);
      }}>Select missing side</button>}
      <p className="field-hint">Yellow shows the new geometry. Chaining follows lines and rounded corners. Positive is left of the selected line, or outside the selected circle/arc.</p>
      {preview.error && <p className="field-hint">{preview.error}</p>}
    </div>
    <div className="dialog-actions"><button className="btn" onClick={close} disabled={busy}>Cancel</button>
      <button className="btn primary" onClick={() => void apply()} disabled={busy || !preview.result}>{editing ? "Save offset" : "Create offset"}</button></div>
  </DraggablePanel>;
}
