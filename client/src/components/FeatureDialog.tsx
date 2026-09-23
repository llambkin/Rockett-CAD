/**
 * Contextual feature panel (right side): parameter forms for each operation.
 * Flow: select geometry → enter parameters → OK commits the parametric
 * feature through the API.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type {
  AxisRef,
  EdgeRef,
  FaceRef,
  Feature,
  PlaneRef,
  ProfileRef,
} from "@rockett/shared";
import { newId } from "@rockett/shared";
import { useStore, type DialogType, type Selection } from "../store";
import { api } from "../api";
import { viewportHandle } from "../viewportRef";
import { DraggablePanel } from "./DraggablePanel";

export function FeatureDialog() {
  const mode = useStore((s) => s.mode);
  if (mode.name !== "dialog") return null;
  return <DialogBody key={mode.dialog + (mode.editFeatureId ?? "")} dialog={mode.dialog} editId={mode.editFeatureId} />;
}

function DialogBody({ dialog, editId }: { dialog: DialogType; editId?: string }) {
  const selection = useStore((s) => s.selection);
  const params = useStore((s) => s.dialogParams);
  const setParams = useStore((s) => s.setDialogParams);
  const setMode = useStore((s) => s.setMode);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const setError = useStore((s) => s.setError);
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
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
  const bodies = selection.filter((s) => s.kind === "body") as Extract<
    Selection,
    { kind: "body" }
  >[];
  const planes = selection.filter((s) => s.kind === "plane") as Extract<
    Selection,
    { kind: "plane" }
  >[];
  // selected sketch LINES (axis candidates for revolve / circular pattern)
  const sketchLines = (selection.filter((s) => s.kind === "sketchEntity") as any[]).filter(
    (s) => {
      const sk = document_?.features.find(
        (f) => f.id === s.sketchId && f.type === "sketch"
      ) as any;
      return sk?.entities.find((x: any) => x.id === s.entityId)?.kind === "line";
    }
  );

  const p = (key: string, dflt: any) => params[key] ?? dflt;
  const num = (key: string, dflt: number) => {
    const v = Number(params[key]);
    return Number.isFinite(v) ? v : dflt;
  };

  // Picking an edge or sketch line in an axis-based dialog switches the axis
  // to it — the dropdown alone gave no hint the pick was registered.
  const axisDialogs: DialogType[] = ["revolve", "linearPattern", "circularPattern"];
  useEffect(() => {
    if (!axisDialogs.includes(dialog)) return;
    if ((edges.length > 0 || sketchLines.length > 0) && params.axisSource !== "edge") {
      setParams({ axisSource: "edge" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges.length, sketchLines.length, dialog]);

  const profileRefs = (): ProfileRef[] =>
    profiles.map((x) => ({ sketchId: x.sketchId, profileId: x.profileId }));
  const edgeRefs = (): EdgeRef[] =>
    edges.map((x) => ({ kind: "edge", bodyId: x.bodyId, edgeName: x.edgeName }));
  const faceRefs = (): FaceRef[] =>
    faces.map((x) => ({ kind: "face", bodyId: x.bodyId, faceName: x.faceName }));
  const planeRef = (): PlaneRef | null => {
    if (planes.length > 0) return planes[0].ref;
    if (faces.length > 0) return { kind: "face", face: faceRefs()[0] };
    return null;
  };
  const axisRef = (): AxisRef => {
    if (p("axisSource", "origin") === "edge") {
      if (sketchLines.length > 0) {
        return {
          kind: "sketchLine",
          sketchId: sketchLines[0].sketchId,
          entityId: sketchLines[0].entityId,
        };
      }
      if (edges.length > 0) return { kind: "edge", edge: edgeRefs()[0] };
    }
    return { kind: "originAxis", axis: p("axis", "Z") };
  };

  const close = () => setMode({ name: "idle" });
  /** Cancel: revert any live-preview edits (e.g. gizmo drags) then close. */
  const cancel = () => {
    void useStore.getState().cancelPreview();
    close();
  };

  const commit = async (feature: Feature) => {
    setPending(true);
    try {
      if (editId) {
        const { id: _ignored, suppressed: _kept, ...patch } = feature as any;
        await updateFeature(editId, patch);
      } else {
        await addFeature(feature);
      }
      close();
    } catch {
      // error toast already set by store
    } finally {
      setPending(false);
    }
  };

  const requireSel = (cond: boolean, msg: string): boolean => {
    if (!cond) {
      setError(msg);
      return false;
    }
    return true;
  };

  // Extrude: typing a negative distance means "into the part" — switch Join to
  // Cut automatically (Fusion-style); going positive again undoes only that
  // automatic switch, never an operation the user picked themselves.
  const extrudeSign = useRef<number | null>(null);
  useEffect(() => {
    if (dialog !== "extrude") return;
    // unset = the dialog's default of 10, so the very first negative counts
    const d = Number(params.distance ?? 10);
    if (!Number.isFinite(d) || d === 0) return;
    const sign = d < 0 ? -1 : 1;
    const prev = extrudeSign.current;
    extrudeSign.current = sign;
    if (prev === null || prev === sign) return;
    const op = params.operation ?? "join";
    if (sign < 0 && op === "join") setParams({ operation: "cut", autoCut: true });
    else if (sign > 0 && op === "cut" && params.autoCut) setParams({ operation: "join", autoCut: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.distance, dialog]);

  // Move edits live-preview (fields or gizmo drag both go through params)
  const movePreviewFirst = useRef(true);
  useEffect(() => {
    if (dialog !== "move" || !editId) return;
    if (movePreviewFirst.current) {
      movePreviewFirst.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void useStore.getState().updateFeaturePreview(editId, {
        translation: [num("tx", 0), num("ty", 0), num("tz", 0)],
      } as any);
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tx, params.ty, params.tz, dialog, editId]);

  let title = "";
  let body: ReactElement | null = null;
  let onOk: (() => Promise<void>) | null = null;

  switch (dialog) {
    case "importStep": {
      const feature = document_?.features.find(f => f.id === editId);
      return <DraggablePanel title="Imported STEP">
        <div className="dialog-body">
          <p>{feature?.type === "importStep" ? feature.filename : "STEP import"}</p>
          <p>Imported solid bodies are the starting geometry. Add sketches, cuts, fillets, and other features to modify them.</p>
          <p>The originating CAD program’s sketches and feature history are not included in STEP files.</p>
        </div>
        <div className="dialog-actions"><button className="btn" onClick={close}>Close</button></div>
      </DraggablePanel>;
    }
    case "extrude": {
      title = "Extrude";
      body = (
        <>
          <SelInfo
            label="Profiles / faces"
            count={profiles.length + faces.length}
            hint="click sketch regions or planar faces"
          />
          <NumField label="Start offset (mm)" value={p("startOffset", 0)} onChange={(v) => setParams({ startOffset: v })} />
          <div className="field-hint">0 = start on the sketch / face; ± moves the start plane along its normal</div>
          <NumField label="Distance (mm)" value={p("distance", 10)} onChange={(v) => setParams({ distance: v })} />
          <div className="field-hint">Negative = the other side (switches to Cut)</div>
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
            <NumField label="Distance 2 (mm)" value={p("distance2", 5)} onChange={(v) => setParams({ distance2: v })} />
          )}
          <SelectField
            label="Operation"
            value={p("operation", "join")}
            options={[
              ["newBody", "New body"],
              ["join", "Join"],
              ["cut", "Cut"],
              ["intersect", "Intersect"],
            ]}
            onChange={(v) => setParams({ operation: v, autoCut: false })}
          />
        </>
      );
      onOk = async () => {
        if (
          !requireSel(
            profiles.length + faces.length > 0,
            "Select at least one profile or planar face"
          )
        )
          return;
        if (!requireSel(num("distance", 10) !== 0, "Extrude distance must be non-zero")) return;
        await commit({
          id: editId ?? newId("extrude"),
          type: "extrude",
          name: p("name", ""),
          suppressed: false,
          profiles: profileRefs(),
          faces: faceRefs(),
          distance: num("distance", 10),
          distance2: num("distance2", 5),
          startOffset: num("startOffset", 0),
          direction: p("direction", "normal"),
          operation: p("operation", "join"),
        });
      };
      break;
    }
    case "revolve": {
      title = "Revolve";
      body = (
        <>
          <SelInfo label="Profiles" count={profiles.length} hint="click sketch regions" />
          <SelInfo
            label="Axis"
            count={edges.length + sketchLines.length}
            hint="click a sketch line or body edge, or pick X/Y/Z"
          />
          <SelectField
            label="Axis"
            value={p("axisSource", "origin") === "edge" ? "edge" : p("axis", "Z")}
            options={[
              ["X", "X axis"],
              ["Y", "Y axis"],
              ["Z", "Z axis"],
              ["edge", "Selected line/edge"],
            ]}
            onChange={(v) =>
              v === "edge"
                ? setParams({ axisSource: "edge" })
                : setParams({ axisSource: "origin", axis: v })
            }
          />
          <NumField label="Angle (°)" value={p("angle", 360)} onChange={(v) => setParams({ angle: v })} />
          <SelectField
            label="Operation"
            value={p("operation", "join")}
            options={[
              ["newBody", "New body"],
              ["join", "Join"],
              ["cut", "Cut"],
              ["intersect", "Intersect"],
            ]}
            onChange={(v) => setParams({ operation: v })}
          />
        </>
      );
      onOk = async () => {
        if (!requireSel(profiles.length > 0, "Select at least one profile")) return;
        await commit({
          id: editId ?? newId("revolve"),
          type: "revolve",
          name: p("name", ""),
          suppressed: false,
          profiles: profileRefs(),
          axis: axisRef(),
          angle: num("angle", 360),
          operation: p("operation", "join"),
        });
      };
      break;
    }
    case "move": {
      title = "Move";
      body = (
        <>
          <SelInfo label="Bodies" count={bodies.length} hint="click bodies" />
          <NumField label="X (mm)" value={p("tx", 0)} onChange={(v) => setParams({ tx: v })} />
          <NumField label="Y (mm)" value={p("ty", 0)} onChange={(v) => setParams({ ty: v })} />
          <NumField label="Z (mm)" value={p("tz", 0)} onChange={(v) => setParams({ tz: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(bodies.length > 0, "Select at least one body")) return;
        await commit({
          id: editId ?? newId("move"),
          type: "move",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          translation: [num("tx", 0), num("ty", 0), num("tz", 0)],
        });
      };
      break;
    }
    case "sweep": {
      title = "Sweep";
      const sketches = (document_?.features ?? []).filter((f) => f.type === "sketch");
      body = (
        <>
          <SelInfo label="Profile" count={profiles.length} hint="click a sketch region" />
          <SelectField
            label="Path sketch"
            value={p("pathSketchId", "")}
            options={[["", "— choose —"], ...sketches.map((s) => [s.id, s.name] as [string, string])]}
            onChange={(v) => setParams({ pathSketchId: v })}
          />
          <SelectField
            label="Operation"
            value={p("operation", "join")}
            options={[
              ["newBody", "New body"],
              ["join", "Join"],
              ["cut", "Cut"],
            ]}
            onChange={(v) => setParams({ operation: v })}
          />
        </>
      );
      onOk = async () => {
        if (!requireSel(profiles.length > 0, "Select a profile")) return;
        if (!requireSel(!!p("pathSketchId", ""), "Choose a path sketch")) return;
        await commit({
          id: editId ?? newId("sweep"),
          type: "sweep",
          name: p("name", ""),
          suppressed: false,
          profiles: profileRefs(),
          pathSketchId: p("pathSketchId", ""),
          operation: p("operation", "join"),
        });
      };
      break;
    }
    case "loft": {
      title = "Loft";
      body = (
        <>
          <SelInfo label="Sections (in order)" count={profiles.length} hint="click 2+ profiles" />
          <SelectField
            label="Operation"
            value={p("operation", "join")}
            options={[
              ["newBody", "New body"],
              ["join", "Join"],
              ["cut", "Cut"],
            ]}
            onChange={(v) => setParams({ operation: v })}
          />
        </>
      );
      onOk = async () => {
        if (!requireSel(profiles.length >= 2, "Select at least two section profiles")) return;
        await commit({
          id: editId ?? newId("loft"),
          type: "loft",
          name: p("name", ""),
          suppressed: false,
          sections: profileRefs(),
          operation: p("operation", "join"),
        });
      };
      break;
    }
    case "emboss": {
      title = "Emboss";
      body = (
        <>
          <SelInfo label="Profiles" count={profiles.length} hint="sketch on a face, then pick regions" />
          <NumField label="Depth (mm)" value={p("depth", 1)} onChange={(v) => setParams({ depth: v })} />
          <SelectField
            label="Mode"
            value={p("embossMode", "emboss")}
            options={[
              ["emboss", "Emboss (raise)"],
              ["deboss", "Deboss (engrave)"],
            ]}
            onChange={(v) => setParams({ embossMode: v })}
          />
        </>
      );
      onOk = async () => {
        if (!requireSel(profiles.length > 0, "Select profiles")) return;
        await commit({
          id: editId ?? newId("emboss"),
          type: "emboss",
          name: p("name", ""),
          suppressed: false,
          profiles: profileRefs(),
          depth: num("depth", 1),
          mode: p("embossMode", "emboss"),
        });
      };
      break;
    }
    case "fillet": {
      title = "Fillet";
      body = (
        <>
          <SelInfo label="Edges" count={edges.length} hint="click model edges" />
          <label><input type="checkbox" checked={p("tangentChain", true)} onChange={e => setParams({ tangentChain: e.target.checked })} /> Select tangent chain</label>
          <small>Smooth curves chain together; sharp corners stop the selection.</small>
          <NumField label="Radius (mm)" value={p("radius", 2)} onChange={(v) => setParams({ radius: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(edges.length > 0, "Select at least one edge")) return;
        await commit({
          id: editId ?? newId("fillet"),
          type: "fillet",
          name: p("name", ""),
          suppressed: false,
          edges: edgeRefs(),
          radius: num("radius", 2),
          tangentChain: p("tangentChain", true),
        });
      };
      break;
    }
    case "chamfer": {
      title = "Chamfer";
      body = (
        <>
          <SelInfo label="Edges" count={edges.length} hint="click model edges" />
          <label><input type="checkbox" checked={p("tangentChain", true)} onChange={e => setParams({ tangentChain: e.target.checked })} /> Select tangent chain</label>
          <small>Smooth curves chain together; sharp corners stop the selection.</small>
          <NumField label="Distance (mm)" value={p("distance", 1)} onChange={(v) => setParams({ distance: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(edges.length > 0, "Select at least one edge")) return;
        await commit({
          id: editId ?? newId("chamfer"),
          type: "chamfer",
          name: p("name", ""),
          suppressed: false,
          edges: edgeRefs(),
          distance: num("distance", 1),
          tangentChain: p("tangentChain", true),
        });
      };
      break;
    }
    case "shell": {
      title = "Shell";
      body = (
        <>
          <SelInfo label="Faces to remove" count={faces.length} hint="click faces to open" />
          <NumField label="Thickness (mm)" value={p("thickness", 2)} onChange={(v) => setParams({ thickness: v })} />
        </>
      );
      onOk = async () => {
        await commit({
          id: editId ?? newId("shell"),
          type: "shell",
          name: p("name", ""),
          suppressed: false,
          openFaces: faceRefs(),
          thickness: num("thickness", 2),
        });
      };
      break;
    }
    case "combine": {
      title = "Combine";
      body = (
        <>
          <SelInfo
            label="Bodies (first = target)"
            count={bodies.length}
            hint="click bodies — first is the target"
          />
          <SelectField
            label="Operation"
            value={p("operation", "join")}
            options={[
              ["join", "Join"],
              ["cut", "Cut"],
              ["intersect", "Intersect"],
            ]}
            onChange={(v) => setParams({ operation: v })}
          />
          <CheckField label="Keep tools" value={!!p("keepTools", false)} onChange={(v) => setParams({ keepTools: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(bodies.length >= 2, "Select a target body then tool bodies")) return;
        await commit({
          id: editId ?? newId("combine"),
          type: "combine",
          name: p("name", ""),
          suppressed: false,
          operation: p("operation", "join"),
          targetBody: bodies[0].bodyId,
          toolBodies: bodies.slice(1).map((b) => b.bodyId),
          keepTools: !!p("keepTools", false),
        });
      };
      break;
    }
    case "splitBody": {
      title = "Split Body";
      body = (
        <>
          <SelInfo label="Body" count={bodies.length} hint="click the body to split" />
          <SelInfo
            label="Split plane"
            count={planes.length + faces.length}
            hint="click an origin/construction plane or planar face"
          />
        </>
      );
      onOk = async () => {
        if (!requireSel(bodies.length > 0, "Select a body to split")) return;
        const tool = planeRef();
        if (!requireSel(!!tool, "Select a splitting plane")) return;
        await commit({
          id: editId ?? newId("split"),
          type: "splitBody",
          name: p("name", ""),
          suppressed: false,
          body: bodies[0].bodyId,
          tool: tool!,
        });
      };
      break;
    }
    case "offsetFace": {
      title = "Press / Pull";
      body = (
        <>
          <SelInfo label="Faces" count={faces.length} hint="click planar faces" />
          <NumField
            label="Distance (mm, − = inward)"
            value={p("distance", 5)}
            onChange={(v) => setParams({ distance: v })}
          />
        </>
      );
      onOk = async () => {
        if (!requireSel(faces.length > 0, "Select faces")) return;
        await commit({
          id: editId ?? newId("offsetf"),
          type: "offsetFace",
          name: p("name", ""),
          suppressed: false,
          faces: faceRefs(),
          distance: num("distance", 5),
        });
      };
      break;
    }
    case "mirror": {
      title = "Mirror";
      body = (
        <>
          <SelInfo label="Bodies" count={bodies.length} hint="click bodies" />
          <SelInfo
            label="Mirror plane"
            count={planes.length + faces.length}
            hint="origin/construction plane or planar face"
          />
          <CheckField label="Join with source" value={!!p("combine", true)} onChange={(v) => setParams({ combine: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(bodies.length > 0, "Select bodies to mirror")) return;
        const plane = planeRef();
        if (!requireSel(!!plane, "Select a mirror plane")) return;
        await commit({
          id: editId ?? newId("mirror"),
          type: "mirror",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          plane: plane!,
          combine: p("combine", true),
        });
      };
      break;
    }
    case "linearPattern": {
      title = "Rectangular Pattern";
      body = (
        <>
          <SelInfo label="Bodies" count={bodies.length} hint="click bodies" />
          <SelectField
            label="Direction"
            value={p("axisSource", "origin") === "edge" ? "edge" : p("axis", "X")}
            options={[
              ["X", "X axis"],
              ["Y", "Y axis"],
              ["Z", "Z axis"],
              ["edge", "Selected edge"],
            ]}
            onChange={(v) =>
              v === "edge"
                ? setParams({ axisSource: "edge" })
                : setParams({ axisSource: "origin", axis: v })
            }
          />
          <NumField label="Quantity" value={p("count", 3)} onChange={(v) => setParams({ count: v })} int />
          <NumField label="Spacing (mm)" value={p("spacing", 20)} onChange={(v) => setParams({ spacing: v })} />
          <CheckField label="Join instances" value={!!p("combine", false)} onChange={(v) => setParams({ combine: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(bodies.length > 0, "Select bodies to pattern")) return;
        const direction =
          p("axisSource", "origin") === "edge" && edges.length > 0
            ? ({ kind: "edge", edge: edgeRefs()[0] } as const)
            : ({ kind: "axis", axis: p("axis", "X") } as const);
        await commit({
          id: editId ?? newId("lpat"),
          type: "linearPattern",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          direction,
          count: Math.round(num("count", 3)),
          spacing: num("spacing", 20),
          combine: !!p("combine", false),
        });
      };
      break;
    }
    case "circularPattern": {
      title = "Circular Pattern";
      body = (
        <>
          <SelInfo label="Bodies" count={bodies.length} hint="click bodies" />
          <SelectField
            label="Axis"
            value={p("axisSource", "origin") === "edge" ? "edge" : p("axis", "Z")}
            options={[
              ["X", "X axis"],
              ["Y", "Y axis"],
              ["Z", "Z axis"],
              ["edge", "Selected edge"],
            ]}
            onChange={(v) =>
              v === "edge"
                ? setParams({ axisSource: "edge" })
                : setParams({ axisSource: "origin", axis: v })
            }
          />
          <NumField label="Quantity" value={p("count", 6)} onChange={(v) => setParams({ count: v })} int />
          <NumField label="Total angle (°)" value={p("totalAngle", 360)} onChange={(v) => setParams({ totalAngle: v })} />
          <CheckField label="Join instances" value={!!p("combine", false)} onChange={(v) => setParams({ combine: v })} />
        </>
      );
      onOk = async () => {
        if (!requireSel(bodies.length > 0, "Select bodies to pattern")) return;
        await commit({
          id: editId ?? newId("cpat"),
          type: "circularPattern",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          axis: axisRef(),
          count: Math.round(num("count", 6)),
          totalAngle: num("totalAngle", 360),
          combine: !!p("combine", false),
        });
      };
      break;
    }
    case "constructionPlane": {
      title = "Construction Plane";
      body = (
        <>
          <SelInfo
            label="Reference plane(s)"
            count={planes.length + faces.length}
            hint="origin plane / face (2 refs = midplane)"
          />
          <SelectField
            label="Method"
            value={p("method", "offset")}
            options={[
              ["offset", "Offset"],
              ["midplane", "Midplane (2 refs)"],
            ]}
            onChange={(v) => setParams({ method: v })}
          />
          {p("method", "offset") === "offset" && (
            <NumField label="Offset (mm)" value={p("distance", 10)} onChange={(v) => setParams({ distance: v })} />
          )}
        </>
      );
      onOk = async () => {
        const refs: PlaneRef[] = [
          ...planes.map((x) => x.ref),
          ...faces.map((f) => ({ kind: "face" as const, face: { kind: "face" as const, bodyId: f.bodyId, faceName: f.faceName } })),
        ];
        if (p("method", "offset") === "midplane") {
          if (!requireSel(refs.length >= 2, "Select two references for a midplane")) return;
          await commit({
            id: editId ?? newId("plane"),
            type: "constructionPlane",
            name: p("name", ""),
            suppressed: false,
            method: { kind: "midplane", a: refs[0], b: refs[1] },
          });
        } else {
          if (!requireSel(refs.length >= 1, "Select a base plane or face")) return;
          await commit({
            id: editId ?? newId("plane"),
            type: "constructionPlane",
            name: p("name", ""),
            suppressed: false,
            method: { kind: "offset", base: refs[0], distance: num("distance", 10) },
          });
        }
      };
      break;
    }
    case "referenceImage": {
      title = "Reference Image";
      return (
        <ReferenceImagePanel
          editId={editId}
          planeRef={planeRef}
          onClose={close}
        />
      );
    }
    case "export": {
      title = "Export";
      return <ExportPanel onClose={close} />;
    }
  }

  return (
    <DraggablePanel title={title}>
      <div className="dialog-body">{body}</div>
      <div className="dialog-actions">
        <button className="btn primary" disabled={pending} onClick={() => onOk && void onOk()}>
          OK
        </button>
        <button className="btn" disabled={pending} onClick={cancel}>
          Cancel
        </button>
      </div>
    </DraggablePanel>
  );
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/**
 * Numeric field that tolerates partial input: while focused it shows what the
 * user typed (so "-" or "1." don't collapse to NaN and wipe the box) and only
 * reports finite numbers upward.
 */
function NumField({
  label,
  value,
  onChange,
  int,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  int?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(Number.isFinite(value) ? String(value) : "");
  }, [value, focused]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={int ? 1 : "any"}
        value={focused ? text : Number.isFinite(value) ? String(value) : ""}
        onFocus={() => {
          setText(Number.isFinite(value) ? String(value) : "");
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SelInfo({ label, count, hint }: { label: string; count: number; hint: string }) {
  return (
    <div className={`sel-info ${count > 0 ? "have" : ""}`}>
      <span>{label}</span>
      <b>{count > 0 ? `${count} selected` : hint}</b>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reference image panel
// ---------------------------------------------------------------------------

function ReferenceImagePanel({
  editId,
  planeRef,
  onClose,
}: {
  editId?: string;
  planeRef: () => PlaneRef | null;
  onClose: () => void;
}) {
  const document_ = useStore((s) => s.document);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const setError = useStore((s) => s.setError);
  const selection = useStore((s) => s.selection);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);

  const existing = editId
    ? (document_?.features.find((f) => f.id === editId) as any)
    : null;
  const [opacity, setOpacity] = useState<number>(existing?.opacity ?? 0.6);
  const [scale, setScale] = useState<number>(existing?.transform.scale ?? 0.5);
  const [rotation, setRotation] = useState<number>(existing?.transform.rotation ?? 0);
  const [u, setU] = useState<number>(existing?.transform.u ?? 0);
  const [v, setV] = useState<number>(existing?.transform.v ?? 0);
  const [calibrating, setCalibrating] = useState(false);

  // Editing an existing canvas live-previews scale/rotation/position/opacity
  // in the viewport (debounced); Cancel reverts, OK commits as one undo step.
  const firstPreview = useRef(true);
  useEffect(() => {
    if (!existing) return;
    if (firstPreview.current) {
      firstPreview.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void useStore.getState().updateFeaturePreview(editId!, {
        opacity,
        transform: { u, v, rotation, scale },
      } as any);
    }, 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacity, scale, rotation, u, v]);

  const onOk = async () => {
    setPending(true);
    try {
      if (existing) {
        await updateFeature(editId!, {
          opacity,
          transform: { u, v, rotation, scale },
        } as any);
        onClose();
        return;
      }
      if (!file) {
        setError("Choose an image file (PNG, JPEG, WebP)");
        return;
      }
      const plane = planeRef() ?? { kind: "origin" as const, plane: "XY" as const };
      const { assetId } = await api.uploadImage(document_!.id, file);
      const img = new Image();
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
      await addFeature({
        id: newId("canvas"),
        type: "referenceImage",
        name: "",
        suppressed: false,
        plane,
        assetId,
        fileName: file.name,
        transform: { u, v, rotation, scale },
        opacity,
        visible: true,
        width: dims.w,
        height: dims.h,
      });
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  };

  const calibrate = async () => {
    // Two clicks on the image plane, then a real-world distance.
    setCalibrating(true);
    const vp = viewportHandle.current;
    if (!vp || !existing) {
      setCalibrating(false);
      return;
    }
    const clicks: { x: number; y: number; z: number }[] = [];
    const el = vp.renderer.domElement;
    const evalState = useStore.getState().evaluation;
    const frame = evalState?.planes.find((p) => p.featureId === editId)?.frame;
    if (!frame) {
      setCalibrating(false);
      return;
    }
    const handler = (e: PointerEvent) => {
      const pt = vp.screenToPlanePoint(e.clientX, e.clientY, frame);
      if (!pt) return;
      clicks.push({ x: pt.x, y: pt.y, z: pt.z });
      if (clicks.length === 2) {
        el.removeEventListener("pointerdown", handler, true);
        const d = Math.hypot(
          clicks[1].x - clicks[0].x,
          clicks[1].y - clicks[0].y,
          clicks[1].z - clicks[0].z
        );
        const desired = Number(
          window.prompt("Real distance between the two points (mm):", "100")
        );
        setCalibrating(false);
        if (Number.isFinite(desired) && desired > 0 && d > 1e-9) {
          setScale((s) => s * (desired / d));
        }
      }
      e.stopPropagation();
    };
    el.addEventListener("pointerdown", handler, true);
  };

  return (
    <DraggablePanel title="Reference Image">
      <div className="dialog-body">
        {!existing && (
          <>
            <div className={`sel-info ${selection.length > 0 ? "have" : ""}`}>
              <span>Plane</span>
              <b>{selection.length > 0 ? "selected" : "click a plane/face (default XY)"}</b>
            </div>
            <label className="field">
              <span>Image file</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </>
        )}
        <label className="field">
          <span>Scale (mm / pixel)</span>
          <input type="number" step="any" value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Rotation (°)</span>
          <input type="number" step="any" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Position U (mm)</span>
          <input type="number" step="any" value={u} onChange={(e) => setU(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Position V (mm)</span>
          <input type="number" step="any" value={v} onChange={(e) => setV(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Opacity</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
        {existing && (
          <button className="btn" disabled={calibrating} onClick={() => void calibrate()}>
            {calibrating ? "Click two points on the image…" : "Calibrate (2 points)"}
          </button>
        )}
      </div>
      <div className="dialog-actions">
        <button className="btn primary" disabled={pending} onClick={() => void onOk()}>
          OK
        </button>
        <button
          className="btn"
          disabled={pending}
          onClick={() => {
            void useStore.getState().cancelPreview();
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
    </DraggablePanel>
  );
}

// ---------------------------------------------------------------------------
// Export panel
// ---------------------------------------------------------------------------

function ExportPanel({ onClose }: { onClose: () => void }) {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const selection = useStore((s) => s.selection);
  const setError = useStore((s) => s.setError);
  const [format, setFormat] = useState<"stl" | "3mf">("stl");
  const [quality, setQuality] = useState(0.05);
  const [pending, setPending] = useState(false);

  const selectedBodies = useMemo(
    () => selection.filter((s) => s.kind === "body").map((s: any) => s.bodyId),
    [selection]
  );

  const doExport = async () => {
    if (!document_) return;
    setPending(true);
    try {
      const { blob, fileName } = await api.exportModel(
        document_.id,
        format,
        selectedBodies,
        quality
      );
      const a = window.document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
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
        <div className={`sel-info ${selectedBodies.length > 0 ? "have" : ""}`}>
          <span>Bodies</span>
          <b>
            {selectedBodies.length > 0
              ? `${selectedBodies.length} selected`
              : `all visible (${evaluation?.bodies.filter((b) => b.visible).length ?? 0})`}
          </b>
        </div>
        <label className="field">
          <span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
            <option value="stl">STL (binary)</option>
            <option value="3mf">3MF (multi-body, named)</option>
          </select>
        </label>
        <label className="field">
          <span>Quality (mm deviation)</span>
          <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
            <option value={0.1}>Draft (0.1)</option>
            <option value={0.05}>Standard (0.05)</option>
            <option value={0.01}>Fine (0.01)</option>
          </select>
        </label>
      </div>
      <div className="dialog-actions">
        <button className="btn primary" disabled={pending} onClick={() => void doExport()}>
          {pending ? "Exporting…" : "Download"}
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </DraggablePanel>
  );
}
