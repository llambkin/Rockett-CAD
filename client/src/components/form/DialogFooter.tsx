import { useEffect, useRef } from "react";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const inside =
        target instanceof Node &&
        ref.current?.parentElement?.contains(target) === true;
      if (e.key === "Escape" && !pending && (inside || escapeAnywhere))
        onCancel();
      else if (
        e.key === "Enter" &&
        inside &&
        canOk &&
        target instanceof HTMLInputElement &&
        target.type !== "file"
      )
        onOk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
