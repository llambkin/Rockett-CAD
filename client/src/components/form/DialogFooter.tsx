import { useEffect, useRef } from "react";
import { pushKeyContext, type KeyEvent } from "../../commands/keymap";

export function DialogFooter({
  onOk,
  onCancel,
  pending = false,
  okLabel = "OK",
  cancelLabel = "Cancel",
  okDisabled = false,
  escapeAnywhere = false,
}: {
  onOk?: () => void;
  onCancel: () => void;
  pending?: boolean;
  okLabel?: string;
  cancelLabel?: string;
  okDisabled?: boolean;
  escapeAnywhere?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canOk = onOk !== undefined && !pending && !okDisabled;
  const latest = useRef({ onOk, onCancel, pending, canOk, escapeAnywhere });
  latest.current = { onOk, onCancel, pending, canOk, escapeAnywhere };
  useEffect(() => {
    return pushKeyContext({
      kind: "overlay",
      handle: (e: KeyEvent) => {
        const { onOk, onCancel, pending, canOk, escapeAnywhere } =
          latest.current;
        const target = e.target;
        const inside =
          target instanceof Node &&
          ref.current?.parentElement?.contains(target) === true;
        if (e.key === "Escape" && (inside || escapeAnywhere)) {
          if (!pending && !e.repeat) onCancel();
          return true;
        }
        if (
          e.key === "Enter" &&
          inside &&
          target instanceof HTMLInputElement &&
          target.type !== "file"
        ) {
          if (canOk && !e.repeat) onOk?.();
          return true;
        }
        return false;
      },
    });
  }, []);
  return (
    <div className="dialog-actions" ref={ref}>
      {onOk && (
        <button
          className="btn primary"
          disabled={pending || okDisabled}
          onClick={onOk}
        >
          {okLabel}
        </button>
      )}
      <button className="btn" disabled={pending} onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  );
}
