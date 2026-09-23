export const THEME_TOKENS = {
  bg0: "#1e2124",
  bg1: "#26292d",
  bg2: "#2e3237",
  bg3: "#383d43",
  border: "#43494f",
  text: "#d6dae0",
  "text-dim": "#9aa2ab",
  accent: "#3ba1e8",
  "accent-dim": "#2b7fb8",
  ok: "#47b04b",
  warn: "#e8a33b",
  err: "#e85a4f",
  danger: "#ff5a5a",
  "on-accent": "#fff",
  "err-fill": "#4a2622",
  "err-fill-text": "#f4c7c3",
  "bg-glow": "#2a2f36",
  offset: "#ffcc66",
  "offset-border": "#d6a74d",
  "offset-fill": "#282b30",
  "hint-fill": "rgba(30, 33, 36, 0.85)",
  "label-fill": "rgba(38, 41, 45, 0.9)",
  "entry-fill": "rgba(38, 41, 45, 0.92)",
  "accent-wash": "rgba(59, 161, 232, 0.14)",
  "shadow-strong": "rgba(0, 0, 0, 0.9)",
  "shadow-menu": "rgba(0, 0, 0, 0.5)",
  "shadow-panel": "rgba(0, 0, 0, 0.4)",
} as const;

export type ThemeTokens = { readonly [K in keyof typeof THEME_TOKENS]: string };

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
