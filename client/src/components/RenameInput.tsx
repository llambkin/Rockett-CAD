import { useState } from "react";

export function RenameInput({
  value,
  className,
  label = "Project name",
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  label?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const commit = () => {
    const t = text.trim();
    if (t && t !== value) onCommit(t);
    else onCancel();
  };
  return (
    <input
      autoFocus
      className={className}
      aria-label={label}
      value={text}
      maxLength={200}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
