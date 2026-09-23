import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { contrastRatio } from "../src/theme/contrast";
import { THEME_TOKENS, type ThemeColor } from "../src/theme/tokens";

it("matches known WCAG ratios", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  expect(contrastRatio("#66b3ff", "#1a1a1a")).toBeCloseTo(7.84, 2);
  expect(contrastRatio("#123456", "#123456")).toBe(1);
});

it("paints the graded greys and the primary text white", () => {
  expect(THEME_TOKENS.bg0).toBe("#1e2124");
  expect(THEME_TOKENS["viewport-bg"]).toBe("#2a2d30");
  expect(THEME_TOKENS.text).toBe("#ffffff");
  expect(THEME_TOKENS["viewcube-face"]).toBe("#3d4249");
});

const surfaces: ThemeColor[] = [
  "bg0",
  "bg1",
  "bg2",
  "bg3",
  "bg-glow",
  "hint-fill",
  "label-fill",
  "entry-fill",
  "offset-fill",
];
const text: ThemeColor[] = [
  "text",
  "text-dim",
  "accent",
  "ok",
  "warn",
  "err",
  "danger",
  "offset",
];
const marks: ThemeColor[] = [
  "body",
  "selection",
  "hover",
  "sketch-line",
  "sketch-point",
  "sketch-inactive",
  "sketch-dimmed",
  "sketch-construction",
  "sketch-external",
  "profile-fill",
  "plane",
  "origin-plane",
  "origin-plane-border",
  "axis-x",
  "axis-y",
  "axis-z",
  "move-axis-x",
  "move-axis-y",
  "move-axis-z",
  "gizmo",
  "gizmo-hover",
  "gizmo-handle",
  "gizmo-cut",
  "move-axis-hover",
  "viewcube-edge",
  "viewcube-border",
];

type Pair = [ThemeColor, ThemeColor, number];

const pairs: Pair[] = [
  ...surfaces.flatMap((bg) => text.map((fg): Pair => [fg, bg, 7])),
  ...surfaces.map((bg): Pair => ["border", bg, 3]),
  ["offset-border", "offset-fill", 3],
  ["on-accent", "accent-dim", 7],
  ["on-accent", "accent-wash", 7],
  ["err-fill-text", "err-fill", 7],
  ["viewcube-label", "viewcube-face", 7],
  ...marks.map((fg): Pair => [fg, "viewport-bg", 3]),
];

it.each(pairs)("%s on %s meets %d:1", (fg, bg, target) => {
  expect(
    contrastRatio(THEME_TOKENS[fg], THEME_TOKENS[bg]),
  ).toBeGreaterThanOrEqual(target);
});

const css = readFileSync(
  fileURLToPath(new URL("../src/theme.css", import.meta.url)),
  "utf8",
);

function declared(selector: string, property: string): ThemeColor | undefined {
  const block = css.split(`\n${selector} {\n`)[1]?.split("}")[0];
  if (block === undefined) throw new Error(`theme.css has no ${selector} rule`);
  const match = new RegExp(`(?:^|\\s)${property}: var\\(--([\\w-]+)\\)`).exec(
    block,
  );
  return match?.[1] as ThemeColor | undefined;
}

function painted(cascade: string[], property: string): ThemeColor | undefined {
  return cascade
    .map((selector) => declared(selector, property))
    .filter((token) => token !== undefined)
    .at(-1);
}

const buttonStates: [string, number, string[]][] = [
  [".btn", 7, [".btn"]],
  [".btn:hover", 4.5, [".btn", ".btn:hover"]],
  [".btn.primary", 7, [".btn", ".btn:hover", ".btn.primary"]],
  [
    ".btn.primary:hover",
    7,
    [".btn", ".btn:hover", ".btn.primary", ".btn.primary:hover"],
  ],
];

it.each(buttonStates)("%s text meets %d:1", (_, target, cascade) => {
  const fg = painted(cascade, "color") ?? "text";
  const bg = painted(cascade, "background") ?? "bg0";
  expect(
    contrastRatio(THEME_TOKENS[fg], THEME_TOKENS[bg]),
  ).toBeGreaterThanOrEqual(target);
});

it("paints every scrollbar thin with the border thumb on the bg1 track", () => {
  const root = css.split("\n:root {\n")[1]?.split("}")[0] ?? "";
  expect(root).toMatch(/\sscrollbar-color: var\(--border\) var\(--bg1\);/);
  expect(css.split("\n* {\n")[1]?.split("}")[0]).toMatch(
    /\sscrollbar-width: thin;/,
  );
  expect(
    contrastRatio(THEME_TOKENS.border, THEME_TOKENS.bg1),
  ).toBeGreaterThanOrEqual(3);
});
