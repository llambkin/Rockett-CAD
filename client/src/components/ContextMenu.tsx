import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pushKeyContext } from "../commands/keymap";

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
    const pop = pushKeyContext({
      kind: "overlay",
      handle: (e) => {
        if (e.key !== "Escape") return false;
        if (!e.repeat) close.current();
        return true;
      },
    });
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      pop();
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

export function MenuButton({
  label,
  title,
  items,
}: {
  label: string;
  title?: string;
  items: MenuItem[];
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        className="icon-btn"
        title={title}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setAt({ x: bounds.left, y: bounds.bottom });
        }}
      >
        {label}
      </button>
      {at && <ContextMenu {...at} items={items} onClose={() => setAt(null)} />}
    </>
  );
}
