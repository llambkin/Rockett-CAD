import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { THEME_TOKENS, applyTheme } from "../src/theme/tokens";

const css = readFileSync(
  fileURLToPath(new URL("../src/theme.css", import.meta.url)),
  "utf8",
);

it("keeps every colour literal out of theme.css", () => {
  const literals = css.match(
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![\w-])(?:white|black)(?![\w-])/g,
  );
  expect(literals).toBeNull();
});

it("defines every custom property theme.css reads", () => {
  const used = [...css.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]);
  expect(used.length).toBeGreaterThan(0);
  expect(used.filter((name) => !(name in THEME_TOKENS))).toEqual([]);
});

it("writes each token as a custom property on the root", () => {
  const written = new Map<string, string>();
  applyTheme(THEME_TOKENS, {
    style: {
      setProperty: (name: string, value: string) => written.set(name, value),
    },
  });
  expect(Object.fromEntries(written)).toEqual(
    Object.fromEntries(
      Object.entries(THEME_TOKENS).map(([name, value]) => [`--${name}`, value]),
    ),
  );
});
