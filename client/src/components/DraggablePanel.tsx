import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PanelLayouts } from "@rockett/shared";
import { panelPlacement } from "../panelPlacement";
import type { PanelLayout, PanelState } from "../panels/layout";
import { getSetting, setSetting } from "../settings";
import { useWorkbench } from "../shell/workbench";
import { useStore } from "../store";
import { TIMING_MS } from "../tunables";

type Point = { x: number; y: number };

const room = () => ({
  viewport: { width: window.innerWidth, height: window.innerHeight },
  cube: document.querySelector(".viewcube")?.getBoundingClientRect(),
});

const panelsOf = (layouts: PanelLayouts, workbench: string): PanelLayout =>
  Object.hasOwn(layouts, workbench) ? layouts[workbench]! : {};

function savedSpot(id: string): Point | null {
  const layout = panelsOf(
    getSetting("layout.panels"),
    useWorkbench.getState().current,
  );
  const saved = Object.hasOwn(layout, id) ? layout[id] : undefined;
  return saved?.kind === "floating" ? { x: saved.x, y: saved.y } : null;
}

function savePanel(workbench: string, id: string, state: PanelState | null) {
  const layouts = getSetting("layout.panels");
  const current = panelsOf(layouts, workbench);
  if (!state && !Object.hasOwn(current, id)) return;
  const kept = Object.entries(current).filter(([key]) => key !== id);
  const layout = Object.fromEntries(state ? [...kept, [id, state]] : kept);
  void setSetting("layout.panels", { ...layouts, [workbench]: layout }).catch(
    (error: Error) => useStore.getState().setError(error.message),
  );
}

function usePanelSave(id: string | undefined) {
  const pending = useRef<{ timer: number; write: () => void } | null>(null);
  const flush = () => {
    const due = pending.current;
    pending.current = null;
    if (!due) return;
    window.clearTimeout(due.timer);
    due.write();
  };
  useEffect(() => flush, []);
  return (state: PanelState | null) => {
    if (!id) return;
    const workbench = useWorkbench.getState().current;
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = {
      timer: window.setTimeout(flush, TIMING_MS.panelSaveDelay),
      write: () => savePanel(workbench, id, state),
    };
  };
}

export function DraggablePanel({
  id,
  title,
  className,
  at,
  children,
}: {
  id?: string;
  title: string;
  className?: string;
  at?: Point;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<Point | null>(
    () => at ?? (id ? savedSpot(id) : null),
  );
  const dragRef = useRef<{ dx: number; dy: number; to?: Point } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const save = usePanelSave(id);
  const reset = () => {
    setPos(at ?? null);
    save(null);
  };
  useLayoutEffect(() => {
    const fit = () =>
      setPos((current) => {
        if (!panelRef.current) return current;
        const rect = panelRef.current.getBoundingClientRect();
        const { viewport, cube } = room();
        const next = panelPlacement(
          current ?? { x: rect.left, y: rect.top },
          rect,
          viewport,
          cube,
        );
        if (!current && next.x === rect.left && next.y === rect.top)
          return current;
        return current && next.x === current.x && next.y === current.y
          ? current
          : next;
      });
    const observer = new ResizeObserver(fit);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const rect = panelRef.current!.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { viewport, cube } = room();
    const to = panelPlacement(
      { x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy },
      {
        width: panelRef.current?.offsetWidth ?? 265,
        height: panelRef.current?.offsetHeight ?? 120,
      },
      viewport,
      cube,
    );
    dragRef.current.to = to;
    setPos(to);
  };
  const onPointerUp = () => {
    const to = dragRef.current?.to;
    dragRef.current = null;
    if (!to || !panelRef.current) return;
    const { width, height } = panelRef.current.getBoundingClientRect();
    save({ kind: "floating", ...to, width, height });
  };

  return (
    <div
      ref={panelRef}
      className={`dialog-panel ${className ?? ""}`}
      style={
        pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              right: "auto",
              bottom: "auto",
              maxHeight: at
                ? "calc(100vh - 8px)"
                : `calc(100vh - ${pos.y + 4}px)`,
            }
          : undefined
      }
    >
      <div
        className="dialog-title"
        title="Drag to move · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onDoubleClick={reset}
      >
        <span>{title}</span>
        <button
          className="panel-reset"
          title="Return panel to its default position"
          aria-label="Reset panel position"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={reset}
        >
          ↗
        </button>
      </div>
      {children}
    </div>
  );
}
