import { useCallback, useRef, type Ref } from "react";
import { useStore } from "../store";
import { themeColor } from "../theme/tokens";

type Anchor = { x: number; y: number } | null;

const PICKER_STYLE = {
  position: "fixed",
  width: 0,
  height: 0,
  padding: 0,
  border: 0,
  opacity: 0,
} as const;

export function BodyColourInput({ input }: { input: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={input}
      type="color"
      tabIndex={-1}
      aria-label="Body colour"
      style={PICKER_STYLE}
    />
  );
}

export function useBodyColour(at: Anchor) {
  const input = useRef<HTMLInputElement | null>(null);
  const bodyId = useRef<string | null>(null);
  const anchor = useRef(at);
  anchor.current = at;
  const attach = useCallback((el: HTMLInputElement) => {
    input.current = el;
    const commit = () => {
      if (bodyId.current)
        void useStore
          .getState()
          .setBodyMeta(bodyId.current, { color: el.value });
    };
    el.addEventListener("change", commit);
    return () => {
      el.removeEventListener("change", commit);
      input.current = null;
    };
  }, []);
  const pick = useCallback((id: string) => {
    const el = input.current;
    if (!el) return;
    bodyId.current = id;
    el.value =
      useStore.getState().document?.bodyMeta[id]?.color ?? themeColor("body");
    el.style.left = `${anchor.current?.x ?? 0}px`;
    el.style.top = `${anchor.current?.y ?? 0}px`;
    el.showPicker();
  }, []);
  return [<BodyColourInput input={attach} />, pick] as const;
}
