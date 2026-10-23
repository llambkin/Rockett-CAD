import { useEffect, useMemo, useState } from "react";
import {
  defaultPlacement,
  importBounds,
  placeImport,
  type EvaluateResult,
  type PlaneFrame,
  type PlacementTarget,
  type SketchFeature,
} from "@rockett/shared";
import { useStore } from "../store";
import { viewportHandle } from "../viewportRef";
import { disposeGroup } from "../three/dispose";
import { previewCurves } from "../three/sketchPreview";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { AngleField, LengthField } from "./form/fields";

export function SketchImportPanel() {
  const pending = useStore((s) => s.sketchImport);
  const inSketch = useStore((s) => s.mode.name === "sketch");
  useEffect(() => {
    if (pending && !inSketch) useStore.setState({ sketchImport: null });
  }, [pending, inSketch]);
  return pending && inSketch ? <PlaceBody /> : null;
}

function faceTarget(
  draft: SketchFeature | null,
  evaluation: EvaluateResult | null,
  frame: PlaneFrame | undefined,
): PlacementTarget | null {
  if (draft?.plane.kind !== "face" || !frame) return null;
  const { bodyId, faceName } = draft.plane.face;
  const body = evaluation?.bodies.find((b) => b.bodyId === bodyId);
  const face = body?.faces.find((f) => f.name === faceName);
  if (!body || !face) return null;
  const [o, xa, ya] = [frame.origin, frame.xAxis, frame.yAxis];
  const us: number[] = [],
    vs: number[] = [];
  for (let i = face.start; i < face.start + face.count; i++) {
    const at = body.indices[i]! * 3;
    const d = [0, 1, 2].map((k) => body.positions[at + k]! - o[k]!);
    us.push(d[0]! * xa[0] + d[1]! * xa[1] + d[2]! * xa[2]);
    vs.push(d[0]! * ya[0] + d[1]! * ya[1] + d[2]! * ya[2]);
  }
  if (!us.length) return null;
  const [u0, u1, v0, v1] = [
    Math.min(...us),
    Math.max(...us),
    Math.min(...vs),
    Math.max(...vs),
  ];
  return {
    x: (u0 + u1) / 2,
    y: (v0 + v1) / 2,
    width: u1 - u0,
    height: v1 - v0,
  };
}

function PlaceBody() {
  const pending = useStore((s) => s.sketchImport)!;
  const draft = useStore((s) => s.draftSketch);
  const evaluation = useStore((s) => s.evaluation);
  const busy = useStore((s) => s.busy);
  const frame = evaluation?.sketches.find(
    (s) => s.featureId === draft?.id,
  )?.frame;
  const entities = pending.imported.entities;
  const bounds = useMemo(() => importBounds(entities), [entities]);
  const [placement, setPlacement] = useState(() =>
    defaultPlacement(entities, faceTarget(draft, evaluation, frame)),
  );
  const width = bounds.maxX - bounds.minX,
    height = bounds.maxY - bounds.minY;
  const placed = useMemo(
    () => placeImport(entities, placement),
    [entities, placement],
  );

  useEffect(() => {
    const vp = viewportHandle.current;
    if (!vp || !frame) return;
    const group = previewCurves(placed, frame);
    vp.scene.add(group);
    vp.requestRender();
    return () => {
      vp.scene.remove(group);
      disposeGroup(group);
      vp.requestRender();
    };
  }, [placed, frame]);

  const update = (patch: Partial<typeof placement>) =>
    setPlacement((p) => ({ ...p, ...patch }));
  const resize = (size: number, of: number) => {
    if (of > 1e-9 && size > 0) update({ scale: size / of });
  };
  return (
    <DraggablePanel title={`Place ${pending.format}`}>
      <div className="dialog-body">
        <p>
          Yellow previews the drawing. Width and height keep its proportions;
          rotation turns it about its centre.
        </p>
        {width > 1e-9 && (
          <LengthField
            label="Width"
            units="mm"
            min={0}
            ariaLabel="Drawing width"
            autoFocus
            value={width * placement.scale}
            onChange={(v) => resize(v, width)}
          />
        )}
        {height > 1e-9 && (
          <LengthField
            label="Height"
            units="mm"
            min={0}
            ariaLabel="Drawing height"
            value={height * placement.scale}
            onChange={(v) => resize(v, height)}
          />
        )}
        <AngleField
          label="Rotation"
          value={placement.rotation}
          onChange={(rotation) => update({ rotation })}
        />
        <LengthField
          label="Centre X"
          units="mm"
          ariaLabel="Drawing centre X"
          value={placement.x}
          onChange={(x) => update({ x })}
        />
        <LengthField
          label="Centre Y"
          units="mm"
          ariaLabel="Drawing centre Y"
          value={placement.y}
          onChange={(y) => update({ y })}
        />
      </div>
      <DialogFooter
        onOk={() => void useStore.getState().placeSketchImport(placement)}
        onCancel={() => void useStore.getState().cancelSketchImport()}
        pending={busy}
        okLabel="Insert"
      />
    </DraggablePanel>
  );
}
