/**
 * Tool panel shell that can be dragged by its title bar, so dialogs can be
 * moved out of the way of the geometry. The position is remembered for the
 * whole session (shared across all tool panels); double-click the title bar
 * to snap back to the default docked position.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { panelPlacement } from "../panelPlacement";

/** Last dragged position, shared by every tool panel for the session. */
let lastPos: { x: number; y: number } | null = null;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function DraggablePanel({
  title,
  className,
  at,
  children,
}: {
  title: string;
  className?: string;
  at?: { x: number; y: number };
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    if (at) return at;
    // discard a remembered position that no longer fits the window
    if (
      lastPos &&
      (lastPos.x > window.innerWidth - 80 ||
        lastPos.y > window.innerHeight - 60)
    ) {
      lastPos = null;
    }
    return lastPos;
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const reset = () => {
    lastPos = null;
    setPos(at ?? null);
  };
  useLayoutEffect(() => {
    const fit = () =>
      setPos((current) => {
        if (!panelRef.current) return current;
        const rect = panelRef.current.getBoundingClientRect();
        const next = panelPlacement(
          current ?? { x: rect.left, y: rect.top },
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          document.querySelector(".viewcube")?.getBoundingClientRect(),
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
    const w = panelRef.current?.offsetWidth ?? 265;
    const p = panelPlacement(
      {
        x: clamp(e.clientX - dragRef.current.dx, 4, window.innerWidth - w - 4),
        y: clamp(
          e.clientY - dragRef.current.dy,
          4,
          window.innerHeight - (panelRef.current?.offsetHeight ?? 120) - 4,
        ),
      },
      { width: w, height: panelRef.current?.offsetHeight ?? 120 },
      { width: window.innerWidth, height: window.innerHeight },
      document.querySelector(".viewcube")?.getBoundingClientRect(),
    );
    lastPos = p;
    setPos(p);
  };
  const onPointerUp = () => {
    dragRef.current = null;
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
