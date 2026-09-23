/**
 * Model browser tree (left panel): Origin, Construction, Canvases, Sketches,
 * Bodies — with visibility toggles, rename, isolate and selection sync.
 */

import { useState } from "react";
import type { Feature } from "@rockett/shared";
import { useStore, selectionKey, type Selection } from "../store";
import {
  viewportHandle,
  alignCameraToActiveSketch as alignToSketch,
} from "../viewportRef";
import { openFeatureEditor } from "./Timeline";
import { freeProfileIds, sketchUsage } from "../sketchUsage";
import { ContextMenu, type MenuItem } from "./ContextMenu";

export function ModelTree() {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const selection = useStore((s) => s.selection);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const setBodyMeta = useStore((s) => s.setBodyMeta);
  const [originVisible, setOriginVisible] = useState(true);
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  if (!document_) return null;
  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setTreeMenu({ x: e.clientX, y: e.clientY, items });
  };
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
        toggleSelection(sel, e.ctrlKey || e.metaKey);
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
    const free = s.document
      ? freeProfileIds(sketchUsage(s.document), sketchId, profiles)
      : [];
    const ids = free.length > 0 ? free : profiles.map((p) => p.id);
    const sels: Selection[] = ids.map((id) => ({
      kind: "profile" as const,
      sketchId,
      profileId: id,
    }));
    s.setSelection(sels);
  };
  const planes = document_.features.filter(
    (f) => f.type === "constructionPlane",
  );
  const canvases = document_.features.filter(
    (f) => f.type === "referenceImage",
  );
  const bodies = evaluation?.bodies ?? [];

  const sketchMenu = (f: Feature): MenuItem[] => [
    {
      label: "Edit sketch",
      action: () =>
        void useStore.getState().editSketch(f.id).then(alignToSketch),
    },
    {
      label: "Extrude regions…",
      action: () => {
        selectSketchRegions(f.id);
        useStore.getState().setMode({ name: "dialog", dialog: "extrude" });
      },
    },
    {
      label: "Revolve regions…",
      action: () => {
        selectSketchRegions(f.id);
        useStore.getState().setMode({ name: "dialog", dialog: "revolve" });
      },
    },
    {
      label: "Rename",
      action: () => setRenaming({ id: f.id, value: f.name }),
    },
    {
      label: "Delete",
      danger: true,
      action: () => void useStore.getState().deleteFeature(f.id),
    },
  ];

  const bodyMenu = (b: (typeof bodies)[number]): MenuItem[] => [
    {
      label: "Move…",
      action: () => {
        const s = useStore.getState();
        s.setMode({ name: "dialog", dialog: "move" });
        s.setSelection([{ kind: "body", bodyId: b.bodyId }]);
        s.setDialogParams({ tx: 0, ty: 0, tz: 0 });
      },
    },
    {
      label: "Rename",
      action: () => setRenaming({ id: b.bodyId, value: b.name }),
    },
    {
      label: "Show / Hide",
      action: () => void setBodyMeta(b.bodyId, { visible: !b.visible }),
    },
    {
      label: "Isolate",
      action: () => {
        for (const other of bodies)
          void setBodyMeta(other.bodyId, {
            visible: other.bodyId === b.bodyId,
          });
      },
    },
    {
      label: "Show all bodies",
      action: () => {
        for (const other of bodies)
          void setBodyMeta(other.bodyId, { visible: true });
      },
    },
  ];

  return (
    <div className="model-tree">
      <div className="tree-doc">{document_.name}</div>
      <div className="tree-sub">Units: {document_.units}</div>

      {section(
        "origin",
        "Origin",
        <>
          <div
            className="tree-item"
            onClick={() => {
              const v = !originVisible;
              setOriginVisible(v);
              viewportHandle.current?.setOriginVisible(v);
            }}
          >
            <span className="tree-icon">{originVisible ? "👁" : "◌"}</span>
            Show origin
          </div>
          {planeRow("XY Plane", {
            kind: "plane",
            ref: { kind: "origin", plane: "XY" },
            label: "XY Plane",
          })}
          {planeRow("XZ Plane", {
            kind: "plane",
            ref: { kind: "origin", plane: "XZ" },
            label: "XZ Plane",
          })}
          {planeRow("YZ Plane", {
            kind: "plane",
            ref: { kind: "origin", plane: "YZ" },
            label: "YZ Plane",
          })}
        </>,
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
                  {
                    kind: "plane",
                    ref: { kind: "construction", featureId: f.id },
                    label: f.name,
                  },
                  e.ctrlKey || e.metaKey,
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
          )),
        )}

      {canvases.length > 0 &&
        section(
          "canvases",
          "Canvases",
          canvases.map((f: any) => (
            <div
              key={f.id}
              className="tree-item"
              onDoubleClick={() => openFeatureEditor(f)}
            >
              <span
                className="tree-icon eye"
                onClick={(e) => {
                  e.stopPropagation();
                  void useStore
                    .getState()
                    .updateFeature(f.id, { visible: !f.visible } as any);
                }}
              >
                {f.visible ? "👁" : "◌"}
              </span>
              {f.name}
            </div>
          )),
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
              onContextMenu={(e) => openMenu(e, sketchMenu(f))}
              title="Click to select regions · double-click to edit"
            >
              <span
                className="tree-icon eye"
                title={
                  (f as any).visible === false ? "Show sketch" : "Hide sketch"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  void useStore.getState().updateFeature(f.id, {
                    visible: (f as any).visible === false,
                  } as any);
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
                f.name
              )}
            </div>
          )),
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
              selection.some(
                (s) => "bodyId" in s && (s as any).bodyId === b.bodyId,
              );
            return (
              <div
                key={b.bodyId}
                className={`tree-item ${isSel ? "selected" : ""}`}
                onClick={(e) => toggleSelection(sel, e.ctrlKey || e.metaKey)}
                onDoubleClick={() =>
                  setRenaming({ id: b.bodyId, value: b.name })
                }
                onContextMenu={(e) => openMenu(e, bodyMenu(b))}
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
                    onChange={(e) =>
                      setRenaming({ id: b.bodyId, value: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void setBodyMeta(b.bodyId, {
                          name: renaming.value || b.name,
                        });
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
        ),
      )}

      {treeMenu && (
        <ContextMenu
          x={treeMenu.x}
          y={treeMenu.y}
          items={treeMenu.items}
          onClose={() => setTreeMenu(null)}
        />
      )}
    </div>
  );
}
