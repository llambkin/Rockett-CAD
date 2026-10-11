import { describe, expect, it } from "vitest";
import { validatePost } from "../src/post/schema.js";
import { validateProgram } from "../src/shared/ir.js";
import {
  fixture,
  fixtures,
  format,
  golden,
  lines,
  loadPost,
} from "./goldens.js";

const post = loadPost("grbl");
const files = (name: string, units: "mm" | "inch" = "mm") =>
  format(post, fixture(name), units);

describe("GRBL 1.1 post", () => {
  it("is a valid post over valid fixtures", () => {
    expect(validatePost(post)).toEqual([]);
    for (const name of fixtures)
      expect(validateProgram(fixture(name))).toEqual([]);
  });

  it("matches the goldens byte for byte", () => {
    for (const name of fixtures) {
      const out = files(name);
      expect(out).toEqual(golden(post, name, out.length));
    }
    expect(files("contour", "inch")).toEqual(golden(post, "contour-inch", 1));
  });

  it("keeps GRBL 1.1 rules", () => {
    const all = fixtures.flatMap((name) => files(name));
    const out = lines(all);
    expect(out.filter((l) => /\bM6\b|\bT\d|\bG8\d\b|;/.test(l))).toEqual([]);
    expect(out.filter((l) => l.startsWith("(") !== l.endsWith(")"))).toEqual(
      [],
    );
    expect(
      out.filter((l) => /\bG[23]\b/.test(l) && !/ I\S+ J/.test(l)),
    ).toEqual([]);
    expect(files("drill")).toHaveLength(2);
    for (const file of all) expect(file).toMatch(/^G90 G94 G91\.1 G17 G21\n/);
    expect(files("contour", "inch")[0]).toMatch(/^G90 G94 G91\.1 G17 G20\n/);
    for (const file of all) expect(file).toMatch(/\nM30\n$/);
  });
});
