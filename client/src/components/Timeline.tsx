import { ViewportContext, type ViewportRef } from "../viewportRef";
import {
  useState,
  useContext,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  CadDocument,
  EvaluateResult,
  Feature,
  FeatureStatus,
} from "@rockett/shared";
import { openInDialog } from "../commands/featureCommand";
import { activeCommand } from "../commands/active";
import { featureUI } from "../features/registry";
import {
  useStore,
  isIdle,
  selectionKey,
  sketchEditingPosition,
  type Selection,
} from "../store";
import { useTimelinePeek } from "../timelinePeek";
import { featureBodies } from "../treeSelection";
import { HorizontalScroll } from "./HorizontalScroll";
import { ContextMenu } from "./ContextMenu";
import { refNotes, useNamingUpgradePanel } from "./RefRepair";
import { QuickEdit, quickValues } from "./QuickEdit";

const typeIcon = (type: string) => featureUI(type)?.icon ?? "•";

function chipTitle(
  f: Feature,
  st: FeatureStatus | undefined,
  document: CadDocument,
  evaluation: EvaluateResult | null,
): string {
  const notes = st?.refs?.length
    ? refNotes(st.refs, document, evaluation, evaluation?.bodies ?? [])
    : [st?.error || st?.warning].filter(Boolean);
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
  if (command?.onSelection) return command.onSelection(bodies, additive);
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
  const idle = useStore(isIdle);
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
        <ContextMenu
          x={menu.x}
          y={menu.y}
          up
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Edit",
              action: () => void openFeatureEditor(menu.feature, viewport),
            },
            ...(idle && quickValues(menu.feature).length > 0
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
            ...upgrade.items(menu.x, menu.y),
          ]}
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
  if (ui?.open) {
    if (viewport) await ui.open(f, viewport);
    else await ui.open(f);
  } else if (ui?.prefill) await openInDialog(ui, f);
}
