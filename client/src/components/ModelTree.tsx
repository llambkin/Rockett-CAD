/**
 * Model browser tree (left panel): Origin, Construction, Canvases, Sketches,
 * Bodies — with visibility toggles, rename, isolate and selection sync.
 */

import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Feature, PlaneRef, TreeGroup } from "@rockett/shared";
import { useStore, selectionKey, type Selection } from "../store";
import {
  viewportHandle,
  alignCameraToActiveSketch as alignToSketch,
} from "../viewportRef";
import { openFeatureEditor } from "./Timeline";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { RenameInput } from "./RenameInput";
import {
  deleteFeatures,
  groupItems,
  groupParts,
  selectSketchRegions,
  sketchSel,
  bodySel,
  renameGroup,
  setBodiesVisible,
  setSketchesVisible,
  treeClick,
  treeIds,
  ungroup,
} from "../treeSelection";

type PlaneSelection = Extract<Selection, { kind: "plane" }>;
type Kind = TreeGroup["kind"];

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

type BodyActions = {
  click: (e: React.MouseEvent, bodyId: string) => void;
  menu: (e: React.MouseEvent, bodyId: string) => void;
  rename: (bodyId: string) => void;
  show: (bodyId: string, visible: boolean) => void;
  commit: (bodyId: string, name: string) => void;
  cancel: () => void;
};

const BodyRow = memo(function BodyRow({
  bodyId,
  name,
  visible,
  selected,
  renaming,
  actions,
}: {
  bodyId: string;
  name: string;
  visible: boolean;
  selected: boolean;
  renaming: boolean;
  actions: BodyActions;
}) {
  return (
    <div
      className={`tree-item ${selected ? "selected" : ""}`}
      onClick={(e) => actions.click(e, bodyId)}
      onDoubleClick={() => actions.rename(bodyId)}
      onContextMenu={(e) => actions.menu(e, bodyId)}
      title="Click to select · right-click for actions"
    >
      <span
        className="tree-icon eye"
        onClick={(e) => {
          e.stopPropagation();
          actions.show(bodyId, !visible);
        }}
      >
        {visible ? "👁" : "◌"}
      </span>
      {renaming ? (
        <RenameInput
          value={name}
          className="tree-rename"
          label="Name"
          onCommit={(next) => actions.commit(bodyId, next)}
          onCancel={actions.cancel}
        />
      ) : (
        <span className={visible ? "" : "dimmed"}>{name}</span>
      )}
    </div>
  );
});

export const ModelTree = memo(function ModelTree() {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const selection = useStore((s) => s.selection);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const setBodyMeta = useStore((s) => s.setBodyMeta);
  const anchor = useRef<Selection | null>(null);
  const [originVisible, setOriginVisible] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  const latest = useRef<BodyActions | null>(null);
  const bodyActions = useMemo(
    (): BodyActions => ({
      click: (e, bodyId) => latest.current!.click(e, bodyId),
      menu: (e, bodyId) => latest.current!.menu(e, bodyId),
      rename: (bodyId) => latest.current!.rename(bodyId),
      show: (bodyId, visible) => latest.current!.show(bodyId, visible),
      commit: (bodyId, name) => latest.current!.commit(bodyId, name),
      cancel: () => latest.current!.cancel(),
    }),
    [],
  );
  const startGroup = async (kind: Kind, ids: string[]) => {
    const group = await groupItems(kind, ids);
    if (group) setRenaming(group.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "g") return;
      const tag = (e.target as HTMLElement).tagName;
      const s = useStore.getState();
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || s.busy) return;
      if (s.mode.name !== "idle") return;
      const kind = treeIds(s.selection, "body").length > 0 ? "body" : "sketch";
      const ids = treeIds(s.selection, kind);
      if (ids.length === 0) return;
      e.preventDefault();
      void startGroup(kind, ids);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!document_) return null;
  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    if (items.length > 0) setTreeMenu({ x: e.clientX, y: e.clientY, items });
  };
  const toggle = (key: string) =>
    setCollapsed({ ...collapsed, [key]: !collapsed[key] });
  const selKeys = new Set(selection.map(selectionKey));
  const pick = (
    e: React.MouseEvent,
    sel: Selection,
    order: Selection[],
    plain: () => void,
  ) => {
    const range = e.shiftKey;
    const additive = e.ctrlKey || e.metaKey;
    const current = anchor.current;
    const from =
      range &&
      current &&
      order.some((o) => selectionKey(o) === selectionKey(current))
        ? current
        : sel;
    anchor.current = from;
    const s = useStore.getState();
    if (!range && !additive) plain();
    else if (!range && s.mode.name === "dialog") toggleSelection(sel, true);
    else s.setSelection(treeClick(s.selection, sel, order, from, range));
  };
  const chosen = (kind: Kind, id: string) => {
    const ids = treeIds(selection, kind);
    return ids.includes(id) ? ids : [id];
  };
  const named = (id: string, name: string, commit: (name: string) => void) =>
    renaming === id ? (
      <RenameInput
        value={name}
        className="tree-rename"
        label="Name"
        onCommit={(next) => {
          setRenaming(null);
          commit(next);
        }}
        onCancel={() => setRenaming(null)}
      />
    ) : null;

  const section = (key: string, label: string, children: ReactNode) => (
    <div className="tree-section">
      <div className="tree-header" onClick={() => toggle(key)}>
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
  const canvases = document_.features.filter(
    (f) => f.type === "referenceImage",
  );
  const bodies = evaluation?.bodies ?? [];

  const sketchParts = groupParts(
    document_.groups,
    collapsed,
    "sketch",
    sketches,
    sketchSel,
  );
  const bodyParts = groupParts(
    document_.groups,
    collapsed,
    "body",
    bodies,
    bodySel,
  );

  const shown = (kind: Kind, ids: string[]) =>
    kind === "body"
      ? bodies.some((b) => ids.includes(b.bodyId) && b.visible)
      : sketches.some(
          (f) => ids.includes(f.id) && (f as any).visible !== false,
        );
  const showHide = (kind: Kind, ids: string[]) => {
    const visible = !shown(kind, ids);
    void (kind === "body"
      ? setBodiesVisible(Object.fromEntries(ids.map((id) => [id, visible])))
      : setSketchesVisible(ids, visible));
  };
  const groupItem = (kind: Kind, ids: string[]): MenuItem => ({
    label: "Group",
    action: () => void startGroup(kind, ids),
  });

  const sketchMenu = (f: Feature): MenuItem[] => {
    const ids = chosen("sketch", f.id);
    if (ids.length > 1)
      return [
        { label: "Show / Hide", action: () => showHide("sketch", ids) },
        groupItem("sketch", ids),
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
      { label: "Rename", action: () => setRenaming(f.id) },
      deleteItem(f.id),
    ];
  };

  const bodyMenu = (bodyId: string): MenuItem[] => {
    const ids = chosen("body", bodyId);
    const visibility = (visible: (id: string) => boolean) =>
      void setBodiesVisible(
        Object.fromEntries(bodies.map((x) => [x.bodyId, visible(x.bodyId)])),
      );
    return [
      {
        label: "Move…",
        action: () => {
          const s = useStore.getState();
          s.setMode({ name: "dialog", dialog: "move" });
          s.setSelection(ids.map((bodyId) => ({ kind: "body", bodyId })));
          s.setDialogParams({ tx: 0, ty: 0, tz: 0 });
        },
      },
      ids.length > 1
        ? groupItem("body", ids)
        : { label: "Rename", action: () => setRenaming(bodyId) },
      { label: "Show / Hide", action: () => showHide("body", ids) },
      {
        label: "Isolate",
        action: () => visibility((id) => ids.includes(id)),
      },
      { label: "Show all bodies", action: () => visibility(() => true) },
    ];
  };

  const groupMenu = (g: TreeGroup, members: Selection[]): MenuItem[] => [
    { label: "Rename", action: () => setRenaming(g.id) },
    { label: "Show / Hide all", action: () => showHide(g.kind, g.members) },
    {
      label: "Select members",
      action: () => useStore.getState().setSelection(members),
    },
    { label: "Ungroup", action: () => void ungroup(g.id) },
  ];

  const groupedRows = <T,>(
    { parts }: { parts: { group: TreeGroup | null; items: T[] }[] },
    selOf: (t: T) => Selection,
    row: (t: T) => ReactNode,
  ) =>
    parts.map(({ group, items }) =>
      group ? (
        <Fragment key={group.id}>
          <div
            className="tree-item"
            onClick={() => toggle(group.id)}
            onContextMenu={(e) =>
              openMenu(e, groupMenu(group, items.map(selOf)))
            }
          >
            <span className="tree-caret">
              {collapsed[group.id] ? "▸" : "▾"}
            </span>
            <span
              className="tree-icon eye"
              onClick={(e) => {
                e.stopPropagation();
                showHide(group.kind, group.members);
              }}
            >
              {shown(group.kind, group.members) ? "👁" : "◌"}
            </span>
            {named(
              group.id,
              group.name,
              (name) => void renameGroup(group.id, name),
            ) ?? group.name}
          </div>
          {!collapsed[group.id] && (
            <div className="tree-children">
              {items.length > 0 ? (
                items.map(row)
              ) : (
                <div className="tree-empty">No members</div>
              )}
            </div>
          )}
        </Fragment>
      ) : (
        items.map(row)
      ),
    );

  const sketchRow = (f: Feature) => {
    const sel = sketchSel(f);
    const isSel =
      selKeys.has(selectionKey(sel)) ||
      selection.some((s) => s.kind === "profile" && s.sketchId === f.id);
    return (
      <div
        key={f.id}
        className={`tree-item ${isSel ? "selected" : ""}`}
        onClick={(e) =>
          pick(e, sel, sketchParts.order, () => selectSketchRegions(f.id))
        }
        onDoubleClick={() => {
          void useStore.getState().editSketch(f.id).then(alignToSketch);
        }}
        onContextMenu={(e) => openMenu(e, sketchMenu(f))}
        title="Click to select regions · double-click to edit"
      >
        <span
          className="tree-icon eye"
          title={(f as any).visible === false ? "Show sketch" : "Hide sketch"}
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
        {named(
          f.id,
          f.name,
          (name) => void useStore.getState().renameFeature(f.id, name),
        ) ?? f.name}
      </div>
    );
  };

  latest.current = {
    click: (e, bodyId) => {
      const sel = bodySel({ bodyId });
      pick(e, sel, bodyParts.order, () => toggleSelection(sel, false));
    },
    menu: (e, bodyId) => openMenu(e, bodyMenu(bodyId)),
    rename: (bodyId) => setRenaming(bodyId),
    show: (bodyId, visible) => void setBodyMeta(bodyId, { visible }),
    commit: (bodyId, name) => {
      setRenaming(null);
      void setBodyMeta(bodyId, { name });
    },
    cancel: () => setRenaming(null),
  };
  const selectedBodies = new Set(
    selection.flatMap((s) => ("bodyId" in s ? [s.bodyId] : [])),
  );
  const bodyRow = (b: (typeof bodies)[number]) => (
    <BodyRow
      key={b.bodyId}
      bodyId={b.bodyId}
      name={b.name}
      visible={b.visible}
      selected={selectedBodies.has(b.bodyId)}
      renaming={renaming === b.bodyId}
      actions={bodyActions}
    />
  );

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

      {sketchParts.parts.length + sketches.length > 1 &&
        section(
          "sketches",
          "Sketches",
          groupedRows(sketchParts, sketchSel, sketchRow),
        )}

      {section(
        "bodies",
        `Bodies (${bodies.length})`,
        bodyParts.parts.length + bodies.length === 1 ? (
          <div className="tree-empty">No bodies yet</div>
        ) : (
          groupedRows(bodyParts, bodySel, bodyRow)
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
});
