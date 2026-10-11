import { sketchOn, toggleFeature } from "./treeFeatureMenus";
import {
  Fragment,
  memo,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Feature, PlaneRef, TreeGroup } from "@rockett/shared";
import { ORIGIN_AXES, UNITS_LENGTH } from "@rockett/shared";
import { activeCommand } from "../commands/active";
import "../commands/design";
import { installKeymap } from "../commands/keymap";
import {
  menuCommand,
  menuItems,
  type MenuTargets,
  type Surface,
} from "../commands/menus";
import { registerCommand } from "../commands/registry";
import { useStore, selectionKey, type Selection } from "../store";
import {
  ViewportContext,
  alignCameraToActiveSketch as alignToSketch,
} from "../viewportRef";
import { openFeatureEditor } from "./Timeline";
import { useBodyColour } from "./BodyColourInput";
import { SurfaceMenu } from "./ContextMenu";
import { RenameInput } from "./RenameInput";
import { pickLabel } from "./form/fields";
import {
  anyShown,
  registerGroupRecipient,
  groupParts,
  selectSketchRegions,
  sketchSel,
  bodySel,
  renameGroup,
  setBodiesVisible,
  showHide,
  treeClick,
  treeIds,
  treeRange,
} from "../treeSelection";
import { importParts, type TreePart } from "../importTree";

type PlaneSelection = Extract<Selection, { kind: "plane" }>;
type Kind = TreeGroup["kind"];

const PLURAL = {
  body: "design.tree.bodies",
  sketch: "design.tree.sketches",
} as const;

registerCommand(
  menuCommand<{ ref: PlaneRef }>(
    "design.menu.sketchOnPlane",
    "Create sketch",
    (s) => sketchOn(s.target.ref, s.viewport),
  ),
);
registerCommand(
  menuCommand<{ feature: Feature }>(
    "design.menu.toggleFeature",
    "Show / Hide",
    ({ target }) => toggleFeature(target.feature),
  ),
);

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

function useTreeGrouping(setRenaming: (id: string) => void) {
  useEffect(() => {
    const uninstall = installKeymap();
    const unregister = registerGroupRecipient(setRenaming);
    return () => {
      unregister();
      uninstall();
    };
  }, []);
}

export const ModelTree = memo(function ModelTree() {
  const viewport = useContext(ViewportContext);
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const anchor = useRef<Selection | null>(null);
  const [originVisible, setOriginVisible] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    surface: Surface;
    target: MenuTargets[Surface];
  } | null>(null);
  const [colourInput, pickColour] = useBodyColour(treeMenu);
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
  useTreeGrouping(setRenaming);

  if (!document_) return null;
  const openMenu = <S extends Surface>(
    e: React.MouseEvent,
    surface: S,
    target: MenuTargets[S],
  ) => {
    e.preventDefault();
    if (menuItems(surface, target, viewport).length > 0)
      setTreeMenu({ x: e.clientX, y: e.clientY, surface, target });
  };
  const toggle = (key: string) =>
    setCollapsed({ ...collapsed, [key]: !collapsed[key] });
  const selKeys = new Set(selection.map(selectionKey));
  const pick = (
    e: React.MouseEvent,
    sel: Selection,
    order: Selection[],
    plain = () => useStore.getState().toggleSelection(sel, false),
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
    const command = activeCommand(s);
    if (range && command?.onRange) command.onRange(treeRange(order, from, sel));
    else if (command?.onSelection)
      command.onSelection([sel], range || additive);
    else if (!range && !additive) plain();
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
  const originAxes = ORIGIN_AXES.map((axis): Selection => ({
    kind: "axis",
    axis,
  }));
  const origins = [...originPlanes, ...originAxes];
  const planeRow = (sel: PlaneSelection) => (
    <div
      key={sel.label}
      className={`tree-item ${selKeys.has(selectionKey(sel)) ? "selected" : ""}`}
      onClick={(e) => {
        if (useStore.getState().active?.id === "design.sketch.create") {
          sketchOn(sel.ref, viewport);
          return;
        }
        pick(e, sel, origins);
      }}
      onContextMenu={(e) =>
        openMenu(e, "design.tree.originPlane", { ref: sel.ref })
      }
    >
      <span className="tree-icon">▱</span>
      {sel.label}
    </div>
  );
  const axisRow = (sel: Selection) => (
    <div
      key={selectionKey(sel)}
      className={`tree-item ${selKeys.has(selectionKey(sel)) ? "selected" : ""}`}
      onClick={(e) => pick(e, sel, origins)}
    >
      <span className="tree-icon">↗</span>
      {pickLabel(sel, document_, evaluation, [])}
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
  const hiddenBodies = new Set(view.hidden.bodies);
  const hiddenFeatures = new Set(view.hidden.features);

  const sketchParts = groupParts(
    document_.groups,
    collapsed,
    "sketch",
    sketches,
    sketchSel,
  );
  const bodyParts = importParts(
    groupParts(document_.groups, collapsed, "body", bodies, bodySel),
    evaluation?.featureStatuses ?? [],
    collapsed,
  );

  const shown = (kind: Kind, ids: string[]) =>
    anyShown({ document: document_, evaluation, view }, kind, ids);
  const rowsMenu = (e: React.MouseEvent, kind: Kind, id: string) => {
    const ids = chosen(kind, id);
    const target = { id, kind, ids, startRename: setRenaming, pickColour };
    if (ids.length > 1) openMenu(e, PLURAL[kind], target);
    else if (kind === "body") openMenu(e, "design.tree.body", target);
    else openMenu(e, "design.tree.sketch", target);
  };

  const groupedRows = <T,>(
    parts: TreePart<T>[],
    selOf: (t: T) => Selection,
    row: (t: T) => ReactNode,
  ): ReactNode[] =>
    parts.map(({ group, items, parts: inner }) =>
      group ? (
        <Fragment key={group.id}>
          <div
            className="tree-item"
            onClick={() => toggle(group.id)}
            onContextMenu={(e) =>
              openMenu(e, inner ? PLURAL.body : "design.tree.groupRow", {
                id: group.id,
                kind: group.kind,
                ids: group.members,
                members: items.map(selOf),
                startRename: setRenaming,
              })
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
              {items.length > 0 || inner ? (
                [...groupedRows(inner ?? [], selOf, row), ...items.map(row)]
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
          void useStore
            .getState()
            .editSketch(f.id)
            .then(() => alignToSketch(viewport));
        }}
        onContextMenu={(e) => rowsMenu(e, "sketch", f.id)}
        title="Click to select regions · double-click to edit"
      >
        <span
          className="tree-icon eye"
          title={hiddenFeatures.has(f.id) ? "Show sketch" : "Hide sketch"}
          onClick={(e) => {
            e.stopPropagation();
            toggleFeature(f);
          }}
        >
          {hiddenFeatures.has(f.id) ? "◌" : "👁"}
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
    click: (e, bodyId) => pick(e, bodySel({ bodyId }), bodyParts.order),
    menu: (e, bodyId) => rowsMenu(e, "body", bodyId),
    rename: (bodyId) => setRenaming(bodyId),
    show: (bodyId, visible) => void setBodiesVisible({ [bodyId]: visible }),
    commit: (bodyId, name) => {
      setRenaming(null);
      void useStore.getState().setBodyMeta(bodyId, { name });
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
      visible={!hiddenBodies.has(b.bodyId)}
      selected={selectedBodies.has(b.bodyId)}
      renaming={renaming === b.bodyId}
      actions={bodyActions}
    />
  );

  return (
    <div className="model-tree">
      <div className="tree-doc">{document_.name}</div>
      <div className="tree-sub">Units: {UNITS_LENGTH.default}</div>

      {section(
        "origin",
        "Origin",
        <>
          <div
            className="tree-item"
            onClick={() => {
              const v = !originVisible;
              setOriginVisible(v);
              viewport.current?.setOriginVisible(v);
            }}
          >
            <span className="tree-icon">{originVisible ? "👁" : "◌"}</span>
            Show origin
          </div>
          {originPlanes.map((p) => planeRow(p))}
          {originAxes.map(axisRow)}
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
              onClick={(e) => pick(e, planeSels[i]!, planeSels)}
              onDoubleClick={() => openFeatureEditor(f, viewport)}
              onContextMenu={(e) =>
                openMenu(e, "design.tree.constructionPlane", {
                  id: f.id,
                  feature: f,
                  ref: { kind: "construction", featureId: f.id },
                })
              }
            >
              <span
                className="tree-icon eye"
                title={hiddenFeatures.has(f.id) ? "Show" : "Hide"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFeature(f);
                }}
              >
                {hiddenFeatures.has(f.id) ? "◌" : "👁"}
              </span>
              {f.name}
            </div>
          )),
        )}

      {canvases.length > 0 &&
        section(
          "canvases",
          "Canvases",
          canvases.map((f) => (
            <div
              key={f.id}
              className="tree-item"
              onDoubleClick={() => openFeatureEditor(f, viewport)}
              onContextMenu={(e) =>
                openMenu(e, "design.tree.canvas", { id: f.id, feature: f })
              }
            >
              <span
                className="tree-icon eye"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFeature(f);
                }}
              >
                {hiddenFeatures.has(f.id) ? "◌" : "👁"}
              </span>
              {f.name}
            </div>
          )),
        )}

      {sketchParts.parts.length + sketches.length > 1 &&
        section(
          "sketches",
          "Sketches",
          groupedRows(sketchParts.parts, sketchSel, sketchRow),
        )}

      {section(
        "bodies",
        `Bodies (${bodies.length})`,
        bodyParts.parts.length + bodies.length === 1 ? (
          <div className="tree-empty">No bodies yet</div>
        ) : (
          groupedRows(bodyParts.parts, bodySel, bodyRow)
        ),
      )}

      {treeMenu && (
        <SurfaceMenu {...treeMenu} onClose={() => setTreeMenu(null)} />
      )}
      {colourInput}
    </div>
  );
});
