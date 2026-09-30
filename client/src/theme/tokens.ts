import { PREVIEW_TINT_STRENGTH, type SettingTypes } from "@rockett/shared";
import { getSetting, subscribe } from "../settings";
import { contrastRatio, rgb } from "./contrast";
import { PALETTES } from "./palette";

function blend(from: string, to: string, strength: number): string {
  const target = rgb(to);
  return `#${rgb(from)
    .map((byte, i) =>
      Math.round(byte + (target[i]! - byte) * strength)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function previewTints(strength: number) {
  return {
    "preview-add": blend(PALETTES.grey.body, PALETTES.grey["axis-y"], strength),
    "preview-cut": blend(PALETTES.grey.body, PALETTES.grey["axis-x"], strength),
  };
}

export { QR_COLOURS } from "./palette";

export const THEME_TOKENS = {
  ...PALETTES.grey,
  ...previewTints(PREVIEW_TINT_STRENGTH.default),
};

export type ThemeTokens = { readonly [K in keyof typeof THEME_TOKENS]: string };

export type ThemeColor = keyof ThemeTokens;

export const THEMES: Record<SettingTypes["appearance.theme"], ThemeTokens> = {
  grey: THEME_TOKENS,
  black: {
    ...PALETTES.black,
    ...previewTints(PREVIEW_TINT_STRENGTH.default),
  },
};

let currentTokens: ThemeTokens = THEME_TOKENS;
const listeners = new Set<(tokens: ThemeTokens) => void>();

export function themeColor(name: ThemeColor): string {
  return currentTokens[name];
}

export function activeTheme(): ThemeTokens {
  return currentTokens;
}

export function subscribeTheme(
  listener: (tokens: ThemeTokens) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type ThemeRoot = {
  style: { setProperty(name: string, value: string): void };
};

export function applyTheme(
  tokens: ThemeTokens,
  root: ThemeRoot = document.documentElement,
): void {
  for (const [name, value] of Object.entries(tokens))
    root.style.setProperty(`--${name}`, value);
  currentTokens = tokens;
  for (const listener of listeners) listener(tokens);
}

export const ACCENT_MIN_CONTRAST = 3;
const ACCENT_FILL_DARKEN = 0.65;

export function accentContrast(accent: string, theme: ThemeTokens): number {
  return Math.min(
    contrastRatio(accent, theme.bg0),
    contrastRatio(accent, theme["viewport-bg"]),
  );
}

export function accentFits(accent: string, theme: ThemeTokens): boolean {
  return accentContrast(accent, theme) >= ACCENT_MIN_CONTRAST;
}

function withAccent(theme: ThemeTokens, accent: string): ThemeTokens {
  if (!accent || !accentFits(accent, theme)) return theme;
  const fill = blend(accent, PALETTES.black.bg0, ACCENT_FILL_DARKEN);
  return {
    ...theme,
    accent,
    "accent-dim": fill,
    "accent-wash": fill,
    selection: accent,
    "profile-fill": accent,
    gizmo: accent,
  };
}

function applyAppearance(): void {
  applyTheme({
    ...withAccent(
      THEMES[getSetting("appearance.theme")],
      getSetting("appearance.accent"),
    ),
    ...previewTints(getSetting("appearance.previewTintStrength")),
  });
}

export function followAppearance(): () => void {
  const stops = [
    subscribe("appearance.theme", applyAppearance),
    subscribe("appearance.accent", applyAppearance),
    subscribe("appearance.previewTintStrength", applyAppearance),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
