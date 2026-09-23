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
  body: "#b7bcc1",
  edge: "#30343a",
  selection: blue,
  hover,
  "sketch-line": text,
  "sketch-point": text,
  "sketch-inactive": "#b3b3b3",
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
  "gizmo-handle": "#ffd166",
  "gizmo-cut": red,
  "move-axis-x": red,
  "move-axis-y": green,
  "move-axis-z": blue,
  "move-axis-hover": hover,
  "viewcube-face": "#1a1a1a",
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
