import { useEffect, useLayoutEffect, useRef } from "react";

export type MenuItem = {
  label: string;
  danger?: boolean;
} & (
  { action: () => void; disabled?: false } | { disabled: true; action?: never }
);

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
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width))}px`;
    panel.style.top = `${Math.max(0, Math.min(up ? y - height : y, window.innerHeight - height))}px`;
    panel.style.bottom = "";
  }, [x, y, up, items.length]);
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
          disabled={it.disabled}
          onClick={() => {
            it.action?.();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
