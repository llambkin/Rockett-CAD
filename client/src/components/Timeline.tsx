import { ViewportContext, type ViewportRef } from "../viewportRef";
import {
  useState,
  useContext,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  bodyName,
  type CadDocument,
  type EvaluateResult,
  type Feature,
  type FeatureStatus,
} from "@rockett/shared";
import { openInDialog } from "../commands/featureCommand";
import { activeCommand } from "../commands/active";
import { menuCommand } from "../commands/menus";
import { registerCommand } from "../commands/registry";
import { featureUI } from "../features/registry";
import { useStore, isIdle, selectionKey, type Selection } from "../store";
import { sketchEditingPosition } from "../sketchEditing";
import { useTimelinePeek } from "../timelinePeek";
import { featureBodies } from "../treeSelection";
import { HorizontalScroll } from "./HorizontalScroll";
import { SurfaceMenu } from "./ContextMenu";
import { refNotes, useNamingUpgradePanel } from "./RefRepair";
import { QuickEdit, quickValues } from "./QuickEdit";

const typeIcon = (type: string) => featureUI(type)?.icon ?? "•";

registerCommand(
  menuCommand<{ feature: Feature }>("design.menu.editFeature", "Edit", (s) =>
    openFeatureEditor(s.target.feature, s.viewport),
  ),
);

export function chipTitle(
  f: Feature,
  st: FeatureStatus | undefined,
  document: CadDocument,
  evaluation: EvaluateResult | null,
): string {
  const error =
    st?.error && st.bodyId
      ? `${st.error} (${bodyName(document, st.bodyId)})`
      : st?.error;
  const notes = st?.refs?.length
    ? refNotes(st.refs, document, evaluation, evaluation?.bodies ?? [])
    : [error || st?.warning].filter(Boolean);
  return [
    `${f.name} (${f.type})`,
    ...notes.map((n) => `⚠ ${n}`),
    ...(f.suppressed ? ["(suppressed)"] : []),
    ...(st?.status === "cancelled" ? ["(cancelled)"] : []),
  ].join("\n");
}

function chipClass(
  f: Feature,
  st: FeatureStatus | undefined,
  selected: boolean,
) {
  return [
    "tl-chip",
    st?.status === "error" ? "error" : "",
    f.suppressed ? "suppressed" : "",
    selected ? "selected" : "",
    st?.status === "rolledBack" || st?.status === "cancelled"
      ? "rolledback"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function selectFeatureBodies(featureId: string, additive: boolean) {
  const s = useStore.getState();
  const bodies = featureBodies(s.evaluation, featureId);
  const command = activeCommand(s);
  const picks = [{ kind: "feature" as const, featureId }, ...bodies];
  if (command?.onSelection) return command.onSelection(picks, additive);
  if (!isIdle(s) || bodies.length === 0) return;
  const had = new Set(s.selection.map(selectionKey));
  s.setSelection(
    additive
      ? [...s.selection, ...bodies.filter((b) => !had.has(selectionKey(b)))]
      : bodies,
  );
}

function chipSelected(
  evaluation: EvaluateResult | null,
  featureId: string,
  selection: Selection[],
) {
  if (!selection.some((x) => x.kind === "body")) return false;
  const keys = new Set(selection.map(selectionKey));
  const bodies = featureBodies(evaluation, featureId);
  return bodies.length > 0 && bodies.every((b) => keys.has(selectionKey(b)));
}

function chipKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      }),
    );
  } else if (e.key === "F10" && e.shiftKey) {
    e.preventDefault();
    const { left, top } = e.currentTarget.getBoundingClientRect();
    e.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: left,
        clientY: top,
      }),
    );
  }
}

function chipMenu(feature: Feature, event: ReactMouseEvent<HTMLDivElement>) {
  event.preventDefault();
  return {
    x: event.clientX,
    y: event.clientY,
    feature,
    anchor: event.currentTarget.getBoundingClientRect(),
  };
}

export function Timeline() {
  const viewport = useContext(ViewportContext);
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const active = useStore((s) => s.active);
  const selection = useStore((s) => s.selection);
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
  const upgrade = useNamingUpgradePanel();

  if (!document_) return null;
  const pos =
    sketchEditingPosition(document_, active) ?? document_.timelinePosition;
  const statuses = new Map(
    (evaluation?.featureStatuses ?? []).map((s) => [s.featureId, s]),
  );

  return (
    <div className="timeline">
      <fieldset
        className="tl-controls"
        disabled={busy || active?.id === "design.sketch"}
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
      <HorizontalScroll className="tl-strip">
        <div
          className={`tl-marker ${pos === 0 ? "current" : ""}`}
          title="Roll to start"
          onClick={() => void rollTimeline(0)}
        />
        {document_.features.map((f, i) => {
          const st = statuses.get(f.id);
          return (
            <span key={f.id} style={{ display: "contents" }}>
              <div
                role="button"
                tabIndex={0}
                onKeyDown={chipKeyDown}
                className={chipClass(
                  f,
                  st,
                  chipSelected(evaluation, f.id, selection),
                )}
                title={chipTitle(f, st, document_, evaluation)}
                onClick={(e) =>
                  selectFeatureBodies(f.id, e.ctrlKey || e.metaKey)
                }
                onDoubleClick={() => void openFeatureEditor(f, viewport)}
                onMouseEnter={() => peek.enter(f.id)}
                onMouseLeave={peek.leave}
                onContextMenu={(e) => setMenu(chipMenu(f, e))}
              >
                <span className="tl-icon">{typeIcon(f.type)}</span>
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
      </HorizontalScroll>
      {menu && (
        <SurfaceMenu
          x={menu.x}
          y={menu.y}
          up
          onClose={() => setMenu(null)}
          surface="design.timeline.chip"
          target={{
            id: menu.feature.id,
            feature: menu.feature,
            startRename: () =>
              setRenaming({ id: menu.feature.id, value: menu.feature.name }),
            quickEdit:
              quickValues(menu.feature).length > 0
                ? () => setQuick(menu)
                : undefined,
            upgradeNaming: upgrade.items(menu.x, menu.y)[0]?.action,
          }}
        />
      )}
      {upgrade.panel}
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

export async function openFeatureEditor(
  f: Feature,
  viewport?: ViewportRef,
): Promise<void> {
  if (useStore.getState().busy) return;
  const ui = featureUI(f.type);
  if (ui?.open) await (viewport ? ui.open(f, viewport) : ui.open(f));
  else if (ui?.prefill) await openInDialog(ui, f);
}
