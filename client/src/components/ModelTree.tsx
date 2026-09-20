/**
 * Model browser tree (left panel): Origin, Construction, Canvases, Sketches,
 * Bodies — with visibility toggles, rename, isolate and selection sync.
 */

import { useState } from "react";
import { useStore, selectionKey, type Selection } from "../store";
import { viewportHandle, alignCameraToActiveSketch as alignToSketch } from "../viewportRef";
import { openFeatureEditor } from "./Timeline";
import { freeProfileIds, sketchUsage } from "../sketchUsage";

export function ModelTree() {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const selection = useStore((s) => s.selection);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const setBodyMeta = useStore((s) => s.setBodyMeta);
  const [originVisible, setOriginVisible] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    kind: "body" | "sketch";
    id: string;
    name: string;
  } | null>(null);

  if (!document_) return null;
  const selKeys = new Set(selection.map(selectionKey));

  const section = (key: string, label: string, children: React.ReactNode) => (
    <div className="tree-section">
      <div
        className="tree-header"
        onClick={() => setCollapsed({ ...collapsed, [key]: !collapsed[key] })}
      >
        <span className="tree-caret">{collapsed[key] ? "▸" : "▾"}</span>
        {label}
      </div>
      {!collapsed[key] && <div className="tree-children">{children}</div>}
    </div>
  );

  const planeRow = (label: string, sel: Selection) => (
    <div
      key={label}
      className={`tree-item ${selKeys.has(selectionKey(sel)) ? "selected" : ""}`}
      onClick={(e) => {
        const s = useStore.getState();
        if (s.mode.name === "pickPlane" && sel.kind === "plane") {
          void s.startSketchOnPlane(sel.ref).then(() => alignToSketch());
          return;
        }
        toggleSelection(sel, (e.ctrlKey || e.metaKey));
      }}
    >
      <span className="tree-icon">▱</span>
      {label}
    </div>
  );

  const sketches = document_.features.filter((f) => f.type === "sketch");

  /** Select a sketch's free regions (all of them when every one is used). */
  const selectSketchRegions = (sketchId: string) => {
    const s = useStore.getState();
    const sk = s.evaluation?.sketches.find((x) => x.featureId === sketchId);
    const profiles = sk?.profiles ?? [];
    const free = s.document ? freeProfileIds(sketchUsage(s.document), sketchId, profiles) : [];
    const ids = free.length > 0 ? free : profiles.map((p) => p.id);
    const sels: Selection[] = ids.map((id) => ({
      kind: "profile" as const,
      sketchId,
      profileId: id,
    }));
    s.setSelection(sels);
  };
  const planes = document_.features.filter((f) => f.type === "constructionPlane");
  const canvases = document_.features.filter((f) => f.type === "referenceImage");
  const bodies = evaluation?.bodies ?? [];

  return (
    <div className="model-tree">
      <div className="tree-doc">{document_.name}</div>
      <div className="tree-sub">Units: {document_.units}</div>

      {section(
        "origin",
        "Origin",
        <>
          <div className="tree-item" onClick={() => {
            const v = !originVisible;
            setOriginVisible(v);
            viewportHandle.current?.setOriginVisible(v);
          }}>
            <span className="tree-icon">{originVisible ? "👁" : "◌"}</span>
            Show origin
          </div>
          {planeRow("XY Plane", { kind: "plane", ref: { kind: "origin", plane: "XY" }, label: "XY Plane" })}
          {planeRow("XZ Plane", { kind: "plane", ref: { kind: "origin", plane: "XZ" }, label: "XZ Plane" })}
          {planeRow("YZ Plane", { kind: "plane", ref: { kind: "origin", plane: "YZ" }, label: "YZ Plane" })}
        </>
      )}

      {planes.length > 0 &&
        section(
          "construction",
          "Construction",
          planes.map((f) => (
            <div
              key={f.id}
              className={`tree-item ${selKeys.has(`plane:${JSON.stringify({ kind: "construction", featureId: f.id })}`) ? "selected" : ""}`}
              onClick={(e) =>
                toggleSelection(
                  { kind: "plane", ref: { kind: "construction", featureId: f.id }, label: f.name },
                  (e.ctrlKey || e.metaKey)
                )
              }
              onDoubleClick={() => openFeatureEditor(f)}
            >
              <span
                className="tree-icon eye"
                title={f.suppressed ? "Show" : "Hide"}
                onClick={(e) => {
                  e.stopPropagation();
                  void useStore.getState().suppressFeature(f.id, !f.suppressed);
                }}
              >
                {f.suppressed ? "◌" : "👁"}
              </span>
              {f.name}
            </div>
          ))
        )}

      {canvases.length > 0 &&
        section(
          "canvases",
          "Canvases",
          canvases.map((f: any) => (
            <div key={f.id} className="tree-item" onDoubleClick={() => openFeatureEditor(f)}>
              <span
                className="tree-icon eye"
                onClick={(e) => {
                  e.stopPropagation();
                  void useStore.getState().updateFeature(f.id, { visible: !f.visible } as any);
                }}
              >
                {f.visible ? "👁" : "◌"}
              </span>
              {f.name}
            </div>
          ))
        )}

      {sketches.length > 0 &&
        section(
          "sketches",
          "Sketches",
          sketches.map((f) => (
            <div
              key={f.id}
              className="tree-item"
              onClick={() => selectSketchRegions(f.id)}
              onDoubleClick={() => {
                void useStore.getState().editSketch(f.id).then(alignToSketch);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTreeMenu({
                  x: e.clientX,
                  y: e.clientY,
                  kind: "sketch",
                  id: f.id,
                  name: f.name,
                });
              }}
              title="Click to select regions · double-click to edit"
            >
              <span
                className="tree-icon eye"
                title={(f as any).visible === false ? "Show sketch" : "Hide sketch"}
                onClick={(e) => {
                  e.stopPropagation();
                  void useStore
                    .getState()
                    .updateFeature(f.id, { visible: (f as any).visible === false } as any);
                }}
              >
                {(f as any).visible === false ? "◌" : "👁"}
              </span>
              <span className="tree-icon">✏</span>
              {renaming?.id === f.id ? (
                <input
                  autoFocus
                  className="tree-rename"
                  value={renaming.value}
                  onChange={(e) => setRenaming({ id: f.id, value: e.target.value })}
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
                f.name
              )}
            </div>
          ))
        )}

      {section(
        "bodies",
        `Bodies (${bodies.length})`,
        bodies.length === 0 ? (
          <div className="tree-empty">No bodies yet</div>
        ) : (
          bodies.map((b) => {
            const sel: Selection = { kind: "body", bodyId: b.bodyId };
            const isSel =
              selKeys.has(selectionKey(sel)) ||
              selection.some((s) => "bodyId" in s && (s as any).bodyId === b.bodyId);
            return (
              <div
                key={b.bodyId}
                className={`tree-item ${isSel ? "selected" : ""}`}
                onClick={(e) => toggleSelection(sel, (e.ctrlKey || e.metaKey))}
                onDoubleClick={() => setRenaming({ id: b.bodyId, value: b.name })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTreeMenu({
                    x: e.clientX,
                    y: e.clientY,
                    kind: "body",
                    id: b.bodyId,
                    name: b.name,
                  });
                }}
                title="Click to select · right-click for actions"
              >
                <span
                  className="tree-icon eye"
                  onClick={(e) => {
                    e.stopPropagation();
                    void setBodyMeta(b.bodyId, { visible: !b.visible });
                  }}
                >
                  {b.visible ? "👁" : "◌"}
                </span>
                {renaming?.id === b.bodyId ? (
                  <input
                    autoFocus
                    className="tree-rename"
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: b.bodyId, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void setBodyMeta(b.bodyId, { name: renaming.value || b.name });
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={b.visible ? "" : "dimmed"}>{b.name}</span>
                )}
              </div>
            );
          })
        )
      )}

      {treeMenu && (
        <>
          <div
            className="ctx-backdrop"
            onPointerDown={() => setTreeMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTreeMenu(null);
            }}
          />
          <div
            className="context-menu"
            style={{ left: treeMenu.x, top: treeMenu.y, bottom: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {treeMenu.kind === "body" && (
              <>
                <button
                  onClick={() => {
                    const s = useStore.getState();
                    s.setMode({ name: "dialog", dialog: "move" });
                    s.setSelection([{ kind: "body", bodyId: treeMenu.id }]);
                    s.setDialogParams({ tx: 0, ty: 0, tz: 0 });
                    setTreeMenu(null);
                  }}
                >
                  Move…
                </button>
                <button
                  onClick={() => {
                    setRenaming({ id: treeMenu.id, value: treeMenu.name });
                    setTreeMenu(null);
                  }}
                >
                  Rename
                </button>
                <button
                  onClick={() => {
                    const b = useStore
                      .getState()
                      .evaluation?.bodies.find((x) => x.bodyId === treeMenu.id);
                    void setBodyMeta(treeMenu.id, { visible: !(b?.visible ?? true) });
                    setTreeMenu(null);
                  }}
                >
                  Show / Hide
                </button>
                <button
                  onClick={() => {
                    const evalBodies = useStore.getState().evaluation?.bodies ?? [];
                    for (const other of evalBodies) {
                      void setBodyMeta(other.bodyId, {
                        visible: other.bodyId === treeMenu.id,
                      });
                    }
                    setTreeMenu(null);
                  }}
                >
                  Isolate
                </button>
                <button
                  onClick={() => {
                    const evalBodies = useStore.getState().evaluation?.bodies ?? [];
                    for (const other of evalBodies) {
                      void setBodyMeta(other.bodyId, { visible: true });
                    }
                    setTreeMenu(null);
                  }}
                >
                  Show all bodies
                </button>
              </>
            )}
            {treeMenu.kind === "sketch" && (
              <>
                <button
                  onClick={() => {
                    void useStore.getState().editSketch(treeMenu.id).then(alignToSketch);
                    setTreeMenu(null);
                  }}
                >
                  Edit sketch
                </button>
                <button
                  onClick={() => {
                    selectSketchRegions(treeMenu.id);
                    useStore.getState().setMode({ name: "dialog", dialog: "extrude" });
                    setTreeMenu(null);
                  }}
                >
                  Extrude regions…
                </button>
                <button
                  onClick={() => {
                    selectSketchRegions(treeMenu.id);
                    useStore.getState().setMode({ name: "dialog", dialog: "revolve" });
                    setTreeMenu(null);
                  }}
                >
                  Revolve regions…
                </button>
                <button
                  onClick={() => {
                    setRenaming({ id: treeMenu.id, value: treeMenu.name });
                    setTreeMenu(null);
                  }}
                >
                  Rename
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    // no confirm — Ctrl+Z restores deleted features
                    void useStore.getState().deleteFeature(treeMenu.id);
                    setTreeMenu(null);
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
