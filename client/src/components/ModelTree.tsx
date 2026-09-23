/**
 * Model browser tree (left panel): Origin, Construction, Canvases, Sketches,
 * Bodies — with visibility toggles, rename, isolate and selection sync.
 */

import { useRef, useState } from "react";
import type { Feature, PlaneRef } from "@rockett/shared";
import { useStore, selectionKey, type Selection } from "../store";
import {
  viewportHandle,
  alignCameraToActiveSketch as alignToSketch,
} from "../viewportRef";
import { openFeatureEditor } from "./Timeline";
import { freeProfileIds, sketchUsage } from "../sketchUsage";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import {
  deleteFeatures,
  setBodiesVisible,
  setSketchesVisible,
  treeClick,
  treeIds,
} from "../treeSelection";

type PlaneSelection = Extract<Selection, { kind: "plane" }>;
type BodySelection = Extract<Selection, { kind: "body" }>;

const sketchOn = (ref: PlaneRef) =>
  void useStore
    .getState()
    .startSketchOnPlane(ref)
    .then(() => alignToSketch());
const planeMenu = (ref: PlaneRef): MenuItem[] =>
  ["idle", "pickPlane"].includes(useStore.getState().mode.name)
    ? [{ label: "Create sketch", action: () => sketchOn(ref) }]
    : [];
const deleteItem = (id: string): MenuItem => ({
  label: "Delete",
  danger: true,
  action: () => void useStore.getState().deleteFeature(id),
});
const togglePlane = (f: Feature) =>
  void useStore.getState().suppressFeature(f.id, !f.suppressed);
const toggleCanvas = (f: any) =>
  void useStore.getState().updateFeature(f.id, { visible: !f.visible } as any);

const constructionMenu = (f: Feature): MenuItem[] => [
  ...planeMenu({ kind: "construction", featureId: f.id }),
  { label: "Edit", action: () => void openFeatureEditor(f) },
  { label: "Show / Hide", action: () => togglePlane(f) },
  deleteItem(f.id),
];

const canvasMenu = (f: Feature): MenuItem[] => [
  { label: "Edit", action: () => void openFeatureEditor(f) },
  { label: "Show / Hide", action: () => toggleCanvas(f) },
  deleteItem(f.id),
];

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

export function ModelTree() {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const selection = useStore((s) => s.selection);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const setBodyMeta = useStore((s) => s.setBodyMeta);
  const anchor = useRef<Selection | null>(null);
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
    if (items.length > 0) setTreeMenu({ x: e.clientX, y: e.clientY, items });
  };
  const selKeys = new Set(selection.map(selectionKey));
  const pick = (
    e: React.MouseEvent,
    sel: Selection,
    order: Selection[],
    plain: () => void,
  ) => {
    const range = e.shiftKey;
    const toggle = e.ctrlKey || e.metaKey;
    const current = anchor.current;
    const from =
      range &&
      current &&
      order.some((o) => selectionKey(o) === selectionKey(current))
        ? current
        : sel;
    anchor.current = from;
    const s = useStore.getState();
    if (!range && !toggle) plain();
    else if (!range && s.mode.name === "dialog") toggleSelection(sel, true);
    else s.setSelection(treeClick(s.selection, sel, order, from, range));
  };
  const chosen = (kind: "body" | "sketch", id: string) => {
    const ids = treeIds(selection, kind);
    return ids.includes(id) ? ids : [id];
  };

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

  const originPlanes = (["XY", "XZ", "YZ"] as const).map(
    (plane): PlaneSelection => ({
      kind: "plane",
      ref: { kind: "origin", plane },
      label: `${plane} Plane`,
    }),
  );
  const planeRow = (sel: PlaneSelection) => (
    <div
      key={sel.label}
      className={`tree-item ${selKeys.has(selectionKey(sel)) ? "selected" : ""}`}
      onClick={(e) => {
        if (useStore.getState().mode.name === "pickPlane") {
          sketchOn(sel.ref);
          return;
        }
        pick(e, sel, originPlanes, () => toggleSelection(sel, false));
      }}
      onContextMenu={(e) => openMenu(e, planeMenu(sel.ref))}
    >
      <span className="tree-icon">▱</span>
      {sel.label}
    </div>
  );

  const sketches = document_.features.filter((f) => f.type === "sketch");

  const planes = document_.features.filter(
    (f) => f.type === "constructionPlane",
  );
  const planeSels = planes.map((f): Selection => ({
    kind: "plane",
    ref: { kind: "construction", featureId: f.id },
    label: f.name,
  }));
  const sketchSels = sketches.map((f): Selection => ({
    kind: "sketch",
    sketchId: f.id,
  }));
  const canvases = document_.features.filter(
    (f) => f.type === "referenceImage",
  );
  const bodies = evaluation?.bodies ?? [];
  const bodySels = bodies.map((b): BodySelection => ({
    kind: "body",
    bodyId: b.bodyId,
  }));

  const sketchMenu = (f: Feature): MenuItem[] => {
    const ids = chosen("sketch", f.id);
    if (ids.length > 1)
      return [
        {
          label: "Show / Hide",
          action: () =>
            void setSketchesVisible(
              ids,
              !sketches.some(
                (x) => ids.includes(x.id) && (x as any).visible !== false,
              ),
            ),
        },
        {
          label: "Delete",
          danger: true,
          action: () => void deleteFeatures(ids),
        },
      ];
    return [
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
      deleteItem(f.id),
    ];
  };

  const bodyMenu = (b: (typeof bodies)[number]): MenuItem[] => {
    const ids = chosen("body", b.bodyId);
    const visibility = (visible: (id: string) => boolean) =>
      void setBodiesVisible(
        Object.fromEntries(bodies.map((x) => [x.bodyId, visible(x.bodyId)])),
      );
    const shown = bodies.some((x) => ids.includes(x.bodyId) && x.visible);
    return [
      {
        label: "Move…",
        action: () => {
          const s = useStore.getState();
          s.setMode({ name: "dialog", dialog: "move" });
          s.setSelection(bodySels.filter((x) => ids.includes(x.bodyId)));
          s.setDialogParams({ tx: 0, ty: 0, tz: 0 });
        },
      },
      ...(ids.length > 1
        ? []
        : [
            {
              label: "Rename",
              action: () => setRenaming({ id: b.bodyId, value: b.name }),
            },
          ]),
      {
        label: "Show / Hide",
        action: () =>
          void setBodiesVisible(
            Object.fromEntries(ids.map((id) => [id, !shown])),
          ),
      },
      {
        label: "Isolate",
        action: () => visibility((id) => ids.includes(id)),
      },
      { label: "Show all bodies", action: () => visibility(() => true) },
    ];
  };

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
          {originPlanes.map((p) => planeRow(p))}
        </>,
      )}

      {planes.length > 0 &&
        section(
          "construction",
          "Construction",
          planes.map((f, i) => (
            <div
              key={f.id}
              className={`tree-item ${selKeys.has(selectionKey(planeSels[i]!)) ? "selected" : ""}`}
              onClick={(e) =>
                pick(e, planeSels[i]!, planeSels, () =>
                  toggleSelection(planeSels[i]!, false),
                )
              }
              onDoubleClick={() => openFeatureEditor(f)}
              onContextMenu={(e) => openMenu(e, constructionMenu(f))}
            >
              <span
                className="tree-icon eye"
                title={f.suppressed ? "Show" : "Hide"}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlane(f);
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
              onContextMenu={(e) => openMenu(e, canvasMenu(f))}
            >
              <span
                className="tree-icon eye"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCanvas(f);
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
          sketches.map((f, i) => (
            <div
              key={f.id}
              className={`tree-item ${selKeys.has(selectionKey(sketchSels[i]!)) || selection.some((s) => s.kind === "profile" && s.sketchId === f.id) ? "selected" : ""}`}
              onClick={(e) =>
                pick(e, sketchSels[i]!, sketchSels, () =>
                  selectSketchRegions(f.id),
                )
              }
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
          bodies.map((b, i) => {
            const sel = bodySels[i]!;
            const isSel =
              selKeys.has(selectionKey(sel)) ||
              selection.some(
                (s) => "bodyId" in s && (s as any).bodyId === b.bodyId,
              );
            return (
              <div
                key={b.bodyId}
                className={`tree-item ${isSel ? "selected" : ""}`}
                onClick={(e) =>
                  pick(e, sel, bodySels, () => toggleSelection(sel, false))
                }
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
