import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

export function ContextMenu({
  x,
  y,
  up = false,
  items,
  onClose,
}: {
  x: number;
  y: number;
  up?: boolean;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="context-menu"
      style={
        up ? { left: x, bottom: window.innerHeight - y } : { left: x, top: y }
      }
    >
      {items.map((it) => (
        <button
          key={it.label}
          className={it.danger ? "danger" : undefined}
          onClick={() => {
            it.action();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
