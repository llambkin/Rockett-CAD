import { useState } from "react";
import type { Feature } from "@rockett/shared";
import {
  useStore,
  sketchEditingPosition,
  type DialogType,
  type Selection,
} from "../store";
import { useTimelinePeek } from "../timelinePeek";
import { alignCameraToActiveSketch } from "../viewportRef";
import { ContextMenu } from "./ContextMenu";
import { QuickEdit, quickValues } from "./QuickEdit";

const TYPE_ICONS: Record<string, string> = {
  importStep: "⇩",
  importMesh: "⇩",
  sketch: "✏",
  extrude: "⬆",
  revolve: "↻",
  sweep: "〰",
  loft: "◆",
  fillet: "◠",
  chamfer: "◣",
  shell: "▢",
  combine: "∪",
  splitBody: "∤",
  offsetFace: "⇱",
  mirror: "⧉",
  linearPattern: "⋮⋮",
  circularPattern: "❋",
  constructionPlane: "▱",
  referenceImage: "🖼",
  emboss: "℘",
  move: "✥",
};

export function Timeline() {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const rollTimeline = useStore((s) => s.rollTimeline);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    feature: Feature;
    anchor: { left: number; top: number };
  } | null>(null);
  const [quick, setQuick] = useState<{
    feature: Feature;
    anchor: { left: number; top: number };
  } | null>(null);
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const peek = useTimelinePeek(quick !== null);

  if (!document_) return null;
  const pos =
    sketchEditingPosition(document_, mode) ?? document_.timelinePosition;
  const statuses = new Map(
    (evaluation?.featureStatuses ?? []).map((s) => [s.featureId, s]),
  );

  const openEditor = (f: Feature) => {
    openFeatureEditor(f);
  };

  return (
    <div className="timeline">
      <fieldset
        className="tl-controls"
        disabled={busy || mode.name === "sketch"}
        style={{ border: 0, margin: 0, padding: 0 }}
      >
        <button title="Roll to start" onClick={() => void rollTimeline(0)}>
          ⏮
        </button>
        <button
          title="Step back"
          onClick={() => void rollTimeline(Math.max(0, pos - 1))}
        >
          ◀
        </button>
        <button
          title="Step forward"
          onClick={() =>
            void rollTimeline(Math.min(document_.features.length, pos + 1))
          }
        >
          ▶
        </button>
        <button
          title="Roll to end"
          onClick={() => void rollTimeline(document_.features.length)}
        >
          ⏭
        </button>
      </fieldset>
      <div className="tl-strip">
        <div
          className={`tl-marker ${pos === 0 ? "current" : ""}`}
          title="Roll to start"
          onClick={() => void rollTimeline(0)}
        />
        {document_.features.map((f, i) => {
          const st = statuses.get(f.id);
          const cls = [
            "tl-chip",
            st?.status === "error" ? "error" : "",
            f.suppressed ? "suppressed" : "",
            st?.status === "rolledBack" ? "rolledback" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span key={f.id} style={{ display: "contents" }}>
              <div
                className={cls}
                title={`${f.name} (${f.type})${st?.error || st?.warning ? `\n⚠ ${st.error ?? st.warning}` : ""}${f.suppressed ? "\n(suppressed)" : ""}`}
                onDoubleClick={() => openEditor(f)}
                onMouseEnter={() => peek.enter(f.id)}
                onMouseLeave={peek.leave}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const { left, top } = e.currentTarget.getBoundingClientRect();
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    feature: f,
                    anchor: { left, top },
                  });
                }}
              >
                <span className="tl-icon">{TYPE_ICONS[f.type] ?? "•"}</span>
                {renaming?.id === f.id ? (
                  <input
                    autoFocus
                    className="tl-rename"
                    value={renaming.value}
                    onChange={(e) =>
                      setRenaming({ id: f.id, value: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void useStore
                          .getState()
                          .renameFeature(f.id, renaming.value || f.name);
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="tl-name">{f.name}</span>
                )}
                {(st?.status === "error" || st?.status === "warning") && (
                  <span className="tl-warn">⚠</span>
                )}
              </div>
              <div
                className={`tl-marker ${pos === i + 1 ? "current" : ""}`}
                title={`Roll to after ${f.name}`}
                onClick={() => void rollTimeline(i + 1)}
              />
            </span>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          up
          onClose={() => setMenu(null)}
          items={[
            { label: "Edit", action: () => openEditor(menu.feature) },
            ...(mode.name === "idle" && quickValues(menu.feature).length > 0
              ? [{ label: "Quick edit", action: () => setQuick(menu) }]
              : []),
            {
              label: "Rename",
              action: () =>
                setRenaming({ id: menu.feature.id, value: menu.feature.name }),
            },
            {
              label: menu.feature.suppressed ? "Unsuppress" : "Suppress",
              action: () =>
                void useStore
                  .getState()
                  .suppressFeature(menu.feature.id, !menu.feature.suppressed),
            },
            {
              label: "Delete",
              danger: true,
              action: () =>
                void useStore.getState().deleteFeature(menu.feature.id),
            },
          ]}
        />
      )}
      {quick && (
        <QuickEdit
          feature={quick.feature}
          anchor={quick.anchor}
          onClose={() => setQuick(null)}
        />
      )}
    </div>
  );
}

/** Open the right editor for a feature: sketch mode, or a prefilled dialog. */
export async function openFeatureEditor(f: Feature): Promise<void> {
  if (useStore.getState().busy) return;
  if (f.type !== "sketch" && useStore.getState().mode.name === "sketch") {
    await useStore.getState().finishSketch();
    if (useStore.getState().mode.name === "sketch") return;
  }
  const s = useStore.getState();
  if (f.type === "sketch") {
    // rolling target: ensure the sketch is inside the active timeline range
    void s.editSketch(f.id).then(alignCameraToActiveSketch);
    return;
  }
  const anyF = f as any;
  const selection: Selection[] = [];
  for (const p of anyF.profiles ?? []) {
    selection.push({
      kind: "profile",
      sketchId: p.sketchId,
      profileId: p.profileId,
    });
  }
  for (const p of anyF.sections ?? []) {
    selection.push({
      kind: "profile",
      sketchId: p.sketchId,
      profileId: p.profileId,
    });
  }
  for (const e of anyF.edges ?? []) {
    selection.push({ kind: "edge", bodyId: e.bodyId, edgeName: e.edgeName });
  }
  for (const fa of anyF.faces ?? anyF.openFaces ?? []) {
    selection.push({ kind: "face", bodyId: fa.bodyId, faceName: fa.faceName });
  }
  if (anyF.targetBody)
    selection.push({ kind: "body", bodyId: anyF.targetBody });
  for (const b of anyF.toolBodies ?? anyF.bodies ?? []) {
    selection.push({ kind: "body", bodyId: b });
  }
  if (anyF.body) selection.push({ kind: "body", bodyId: anyF.body });

  /** Reselect an edge or sketch-line axis so OK rebuilds the same axis. */
  const pushAxis = (axis: any) => {
    if (axis?.kind === "edge") {
      selection.push({
        kind: "edge",
        bodyId: axis.edge.bodyId,
        edgeName: axis.edge.edgeName,
      });
    }
    if (axis?.kind === "sketchLine") {
      selection.push({
        kind: "sketchEntity",
        sketchId: axis.sketchId,
        entityId: axis.entityId,
      });
    }
  };

  const params: Record<string, any> = { name: f.name };
  switch (f.type) {
    case "extrude":
      Object.assign(params, {
        distance: anyF.distance,
        distance2: anyF.distance2,
        startOffset: anyF.startOffset ?? 0,
        direction: anyF.direction,
        operation: anyF.operation,
      });
      break;
    case "revolve":
      Object.assign(params, {
        angle: anyF.angle,
        operation: anyF.operation,
        axisSource: anyF.axis?.kind === "originAxis" ? "origin" : "edge",
        axis: anyF.axis?.kind === "originAxis" ? anyF.axis.axis : "Z",
      });
      pushAxis(anyF.axis);
      break;
    case "sweep":
      Object.assign(params, {
        pathSketchId: anyF.pathSketchId,
        operation: anyF.operation,
      });
      break;
    case "loft":
      Object.assign(params, { operation: anyF.operation });
      break;
    case "fillet":
      Object.assign(params, {
        radius: anyF.radius,
        tangentChain: anyF.tangentChain ?? false,
      });
      break;
    case "chamfer":
      Object.assign(params, {
        distance: anyF.distance,
        tangentChain: anyF.tangentChain ?? false,
      });
      break;
    case "shell":
      Object.assign(params, { thickness: anyF.thickness });
      break;
    case "combine":
      Object.assign(params, {
        operation: anyF.operation,
        keepTools: anyF.keepTools,
      });
      break;
    case "offsetFace":
      Object.assign(params, { distance: anyF.distance });
      break;
    case "mirror":
      Object.assign(params, { combine: anyF.combine });
      if (anyF.plane?.kind)
        selection.push({ kind: "plane", ref: anyF.plane, label: "Plane" });
      break;
    case "linearPattern":
      Object.assign(params, {
        count: anyF.count,
        spacing: anyF.spacing,
        combine: anyF.combine,
        axisSource: anyF.direction?.kind === "axis" ? "origin" : "edge",
        axis: anyF.direction?.kind === "axis" ? anyF.direction.axis : "X",
      });
      pushAxis(anyF.direction);
      break;
    case "circularPattern":
      Object.assign(params, {
        count: anyF.count,
        totalAngle: anyF.totalAngle,
        combine: anyF.combine,
        axisSource: anyF.axis?.kind === "originAxis" ? "origin" : "edge",
        axis: anyF.axis?.kind === "originAxis" ? anyF.axis.axis : "Z",
      });
      pushAxis(anyF.axis);
      break;
    case "splitBody":
      if (anyF.tool)
        selection.push({ kind: "plane", ref: anyF.tool, label: "Tool" });
      break;
    case "constructionPlane":
      Object.assign(params, {
        method: anyF.method?.kind,
        distance: anyF.method?.distance,
      });
      if (anyF.method?.kind === "offset" && anyF.method.base) {
        selection.push({ kind: "plane", ref: anyF.method.base, label: "Base" });
      }
      if (anyF.method?.kind === "midplane") {
        selection.push({ kind: "plane", ref: anyF.method.a, label: "A" });
        selection.push({ kind: "plane", ref: anyF.method.b, label: "B" });
      }
      break;
    case "emboss":
      Object.assign(params, { depth: anyF.depth, embossMode: anyF.mode });
      break;
    case "move":
      Object.assign(params, {
        tx: anyF.translation?.[0] ?? 0,
        ty: anyF.translation?.[1] ?? 0,
        tz: anyF.translation?.[2] ?? 0,
      });
      break;
    default:
      break;
  }
  s.setMode({
    name: "dialog",
    dialog: (f.type === "importMesh" ? "importStep" : f.type) as DialogType,
    editFeatureId: f.id,
  });
  s.setDialogParams(params);
  s.setSelection(selection);
}
