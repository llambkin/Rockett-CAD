import type { ButtonHTMLAttributes } from "react";
import { ICONS, type IconId } from "../icons";

export function ToolButton({
  icon,
  label,
  iconOnly = false,
  className = "",
  title = label,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconId;
  label: string;
  iconOnly?: boolean;
}) {
  const Icon = ICONS[icon];
  return (
    <button
      {...button}
      title={title}
      aria-label={label}
      className={`tb-btn ${iconOnly ? "icon" : ""} ${className}`}
    >
      <Icon />
      {!iconOnly && <span className="tb-label">{label}</span>}
    </button>
  );
}
