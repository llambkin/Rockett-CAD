import type { ButtonHTMLAttributes } from "react";
import { iconOf, type IconId, type ModuleIconId } from "../icons";

export function ToolButton({
  icon,
  label,
  iconOnly = false,
  className = "",
  title = label,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconId | ModuleIconId;
  label: string;
  iconOnly?: boolean;
}) {
  const Icon = iconOf(icon);
  return (
    <button
      {...button}
      title={title}
      aria-label={label}
      className={`tb-btn ${iconOnly ? "icon" : ""} ${className}`}
    >
      {Icon && <Icon />}
      {!iconOnly && <span className="tb-label">{label}</span>}
    </button>
  );
}
