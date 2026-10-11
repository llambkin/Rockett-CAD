import { useEffect, useState } from "react";
import { useSetting } from "../settings";
import { isHexColour } from "../theme/contrast";
import {
  ACCENT_MIN_CONTRAST,
  THEMES,
  accentContrast,
  accentFits,
} from "../theme/tokens";

export function AccentPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = THEMES[useSetting("appearance.theme")];
  const shown = value || theme.accent;
  const [text, setText] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    setRefused(null);
  }, [shown]);
  const commit = (next: string) => {
    if (isHexColour(next) && !accentFits(next, theme)) {
      setRefused(next);
      return;
    }
    setRefused(null);
    onChange(next);
  };
  const measured = refused ?? shown;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <input
          type="color"
          value={shown}
          aria-label={`${label} swatch`}
          onChange={(event) => commit(event.target.value)}
        />
        <input
          type="text"
          value={text ?? shown}
          aria-label={label}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => text !== null && commit(text)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text !== null) commit(text);
          }}
        />
      </label>
      <span className="field-hint">
        Contrast {accentContrast(measured, theme).toFixed(2)}:1 on the
        background, needs {ACCENT_MIN_CONTRAST}:1.
      </span>
      {refused && (
        <span className="settings-error">
          Not saved: the accent needs {ACCENT_MIN_CONTRAST}:1 on the background.
        </span>
      )}
      {!refused && !accentFits(shown, theme) && (
        <span className="settings-warning">
          Under {ACCENT_MIN_CONTRAST}:1 on this theme, so the theme&apos;s
          accent is used.
        </span>
      )}
    </>
  );
}
