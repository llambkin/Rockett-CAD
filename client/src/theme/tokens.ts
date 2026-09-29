import { PREVIEW_TINT_STRENGTH, type SettingTypes } from "@rockett/shared";
import { getSetting, subscribe } from "../settings";
import { contrastRatio, rgb } from "./contrast";

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

const bg0 = "#1e2124";
const bg1 = "#26292d";
const border = "#868686";
const text = "#ffffff";
const accentFill = "#0b3d73";
const err = "#ffbfbf";
const offset = "#ffcc66";
const hover = "#ffd166";
const originPlane = "#999faf";
const blue = "#66b3ff";
const red = "#ff8080";
const green = "#4cc36a";
const body = "#b7bcc1";
const lightGrey = "#b3b3b3";
const black = "#000000";
const raised = "#1a1a1a";
const blackBorder = "#737373";

function previewTints(strength: number) {
  return {
    "preview-add": blend(body, green, strength),
    "preview-cut": blend(body, red, strength),
  };
}

export const QR_COLOURS = { light: "#ffffff", dark: "#000000" };

export const THEME_TOKENS = {
  bg0,
  bg1,
  bg2: "#2e3237",
  bg3: "#383d43",
  border,
  text,
  "text-dim": "#cfcfcf",
  accent: "#a7d4ff",
  "accent-dim": accentFill,
  ok: "#9bdeac",
  warn: "#ffc652",
  err,
  danger: err,
  "on-accent": text,
  "err-fill": "#3d0f0f",
  "err-fill-text": text,
  "bg-glow": "#2a2f36",
  offset,
  "offset-border": offset,
  "offset-fill": "#282b30",
  "hint-fill": bg0,
  "label-fill": bg1,
  "entry-fill": bg1,
  "accent-wash": accentFill,
  "shadow-strong": "rgba(0, 0, 0, 0.9)",
  "shadow-menu": "rgba(0, 0, 0, 0.5)",
  "shadow-panel": "rgba(0, 0, 0, 0.4)",
  "viewport-bg": "#2a2d30",
  body,
  ...previewTints(PREVIEW_TINT_STRENGTH.default),
  edge: "#0d0e10",
  selection: blue,
  hover,
  "sketch-line": text,
  "sketch-point": text,
  "sketch-inactive": lightGrey,
  "sketch-dimmed": border,
  "sketch-construction": "#8f7fe8",
  "sketch-external": "#bb88ff",
  "profile-fill": blue,
  plane: "#4fd1c5",
  "origin-plane": originPlane,
  "origin-plane-border": originPlane,
  "axis-x": red,
  "axis-y": green,
  "axis-z": blue,
  gizmo: blue,
  "gizmo-hover": hover,
  "gizmo-handle": hover,
  "gizmo-cut": red,
  "move-axis-x": red,
  "move-axis-y": green,
  "move-axis-z": blue,
  "move-axis-hover": hover,
  "dim-leader": "#9aa2ab",
  "offset-end": "#ff9933",
  "viewcube-face": "#3d4249",
  "viewcube-border": "#8c8c8c",
  "viewcube-edge": border,
  "viewcube-label": text,
  "light-sky": "#ffffff",
  "light-ground": "#555566",
  "light-key": "#ffffff",
} as const;

export type ThemeTokens = { readonly [K in keyof typeof THEME_TOKENS]: string };

export type ThemeColor = keyof ThemeTokens;

export const THEMES: Record<SettingTypes["appearance.theme"], ThemeTokens> = {
  grey: THEME_TOKENS,
  black: {
    ...THEME_TOKENS,
    bg0: black,
    bg1: black,
    bg2: raised,
    bg3: raised,
    border: blackBorder,
    "text-dim": lightGrey,
    accent: blue,
    ok: green,
    warn: "#ffc247",
    err: red,
    danger: red,
    "bg-glow": black,
    "offset-fill": raised,
    "hint-fill": raised,
    "label-fill": raised,
    "entry-fill": raised,
    "viewport-bg": black,
    "sketch-dimmed": blackBorder,
    "viewcube-face": raised,
    "viewcube-border": blackBorder,
    "viewcube-edge": blackBorder,
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
  return contrastRatio(accent, theme.bg0);
}

export function accentFits(accent: string, theme: ThemeTokens): boolean {
  return accentContrast(accent, theme) >= ACCENT_MIN_CONTRAST;
}

function withAccent(theme: ThemeTokens, accent: string): ThemeTokens {
  if (!accent || !accentFits(accent, theme)) return theme;
  const fill = blend(accent, black, ACCENT_FILL_DARKEN);
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
