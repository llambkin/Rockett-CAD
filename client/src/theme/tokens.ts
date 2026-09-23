const bg = "#000000";
const raised = "#1a1a1a";
const border = "#737373";
const text = "#ffffff";
const textDim = "#b3b3b3";
const accent = "#66b3ff";
const accentFill = "#0b3d73";
const ok = "#4cc36a";
const err = "#ff8080";
const offset = "#ffcc66";
const hover = "#ffd166";
const originPlane = "#999faf";

export const THEME_TOKENS = {
  bg0: bg,
  bg1: bg,
  bg2: raised,
  bg3: raised,
  border,
  text,
  "text-dim": textDim,
  accent,
  "accent-dim": accentFill,
  ok,
  warn: "#ffc247",
  err,
  danger: err,
  "on-accent": text,
  "err-fill": "#3d0f0f",
  "err-fill-text": text,
  "bg-glow": bg,
  offset,
  "offset-border": offset,
  "offset-fill": raised,
  "hint-fill": raised,
  "label-fill": raised,
  "entry-fill": raised,
  "accent-wash": accentFill,
  "shadow-strong": "rgba(0, 0, 0, 0.9)",
  "shadow-menu": "rgba(0, 0, 0, 0.5)",
  "shadow-panel": "rgba(0, 0, 0, 0.4)",
  "viewport-bg": bg,
  body: "#b7bcc1",
  edge: "#30343a",
  selection: accent,
  hover,
  "sketch-line": text,
  "sketch-point": text,
  "sketch-inactive": textDim,
  "sketch-dimmed": border,
  "sketch-construction": "#8f7fe8",
  "sketch-external": "#bb88ff",
  "profile-fill": accent,
  plane: "#4fd1c5",
  "origin-plane": originPlane,
  "origin-plane-border": originPlane,
  "axis-x": err,
  "axis-y": ok,
  "axis-z": accent,
  gizmo: accent,
  "gizmo-hover": hover,
  "gizmo-handle": "#ffd166",
  "gizmo-cut": err,
  "move-axis-x": err,
  "move-axis-y": ok,
  "move-axis-z": accent,
  "move-axis-hover": hover,
  "viewcube-face": raised,
  "viewcube-border": border,
  "viewcube-edge": border,
  "viewcube-label": text,
  "light-sky": "#ffffff",
  "light-ground": "#555566",
  "light-key": "#ffffff",
} as const;

export type ThemeTokens = { readonly [K in keyof typeof THEME_TOKENS]: string };

export type ThemeColor = keyof ThemeTokens;

export function themeColor(name: ThemeColor): string {
  return THEME_TOKENS[name];
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
}
