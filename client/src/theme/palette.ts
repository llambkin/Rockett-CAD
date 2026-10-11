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

export const QR_COLOURS = { light: "#ffffff", dark: "#000000" };

const grey = {
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

export const PALETTES = {
  grey,
  black: {
    ...grey,
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
