import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readBoard, BOARD_LIMITS } from "../src/board.js";
import { parseSexpr } from "../src/sexpr.js";

const edge = '(layer "Edge.Cuts")';
const line = (a: string, b: string) =>
  `(gr_line (start ${a}) (end ${b}) ${edge})`;
const rect = (a: string, b: string) =>
  `(gr_rect (start ${a}) (end ${b}) ${edge})`;
const circle = (a: string, b: string) =>
  `(gr_circle (center ${a}) (end ${b}) ${edge})`;
const arc = (a: string, m: string, b: string) =>
  `(gr_arc (start ${a}) (mid ${m}) (end ${b}) ${edge})`;
const poly = (points: string[]) =>
  `(gr_poly (pts ${points.map((p) => `(xy ${p})`).join(" ")}) ${edge})`;
const board = (items: string, version = 20241229) =>
  parseSexpr(
    `(kicad_pcb (version ${version}) (general (thickness 1.6)) ${items})`,
  );

describe("KiCad board outline", () => {
  it("reads equal exact loops from handwritten KiCad 9 and 10 writer fixtures", () => {
    const fixtures = [9, 10].map((version) =>
      readBoard(
        parseSexpr(
          readFileSync(
            new URL(
              `fixtures/outline-kicad${version}.kicad_pcb`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ),
    );
    expect(fixtures[0]!.formatVersion).toBe(20241229);
    expect(fixtures[1]!.formatVersion).toBe(20260206);
    expect(fixtures[0]!.outline).toEqual(fixtures[1]!.outline);
    expect(fixtures[0]!.cutouts).toEqual(fixtures[1]!.cutouts);
    expect(fixtures[0]!.cutouts).toHaveLength(3);
    expect(fixtures[0]!.outline[0]!.from).toEqual([0, 0]);
    expect(fixtures[0]!.outline[0]!.to).toEqual([20, 0]);
    expect(fixtures[0]!.thickness).toBe(1.6);
    expect(fixtures[0]!.warnings).toEqual([]);
    expect(fixtures[1]!.warnings).toEqual([]);
    expect(fixtures[0]!.stackup).toEqual(fixtures[1]!.stackup);
    expect(fixtures[0]!.stackup).toMatchObject({
      copperFinish: "ENIG",
      dielectricConstraints: true,
      edgeConnector: "bevelled",
      castellatedPads: true,
      edgePlating: true,
      layers: [
        { name: "F.Cu", type: "copper", sublayers: [{ thickness: 0.035 }] },
        {
          name: "dielectric 1",
          type: "core",
          sublayers: [
            {
              thickness: 0.7,
              locked: true,
              material: "FR4",
              epsilonR: 4.5,
              lossTangent: 0.02,
            },
            { thickness: 0.83, material: "FR4", epsilonR: 4.2 },
          ],
        },
        { name: "B.Cu" },
      ],
    });
  });

  it("enforces the KiCad 9 floor by format version and warns above the KiCad 10 fixture", () => {
    expect(() => readBoard(board(rect("0 0", "10 10"), 20241228))).toThrow(
      /KiCad 9/,
    );
    expect(readBoard(board(rect("0 0", "10 10"), 20260207)).warnings).toEqual([
      "untested version",
    ]);
    expect(() =>
      readBoard(
        parseSexpr(
          '(kicad_pcb (generator_version "10.0") (general (thickness 1.6)))',
        ),
      ),
    ).toThrow(/version/);
    expect(() =>
      readBoard(parseSexpr("(footprint (version 20260206))")),
    ).toThrow(/kicad_pcb/);
  });

  it("chains shuffled and reversed lines within 1e-3 mm without changing source data", () => {
    const tree = board(
      [
        line("10 10", "10 0"),
        line("0 0", "10.0006 0.0006"),
        line("0 10", "10 10"),
        line("0 0", "0 10"),
      ].join(" "),
    );
    const original = JSON.stringify(tree);
    const result = readBoard(tree);
    expect(result.outline).toHaveLength(4);
    for (const [i, segment] of result.outline.entries()) {
      const next = result.outline[(i + 1) % result.outline.length]!;
      expect(
        Math.hypot(segment.to[0] - next.from[0], segment.to[1] - next.from[1]),
      ).toBeLessThanOrEqual(1e-3);
    }
    expect(JSON.stringify(tree)).toBe(original);
    expect(() =>
      readBoard(
        board(
          [
            line("10 10", "10 0"),
            line("0 0", "10.0008 0.0008"),
            line("0 10", "10 10"),
            line("0 0", "0 10"),
          ].join(" "),
        ),
      ),
    ).toThrow(/open chain/i);
  });

  it("keeps major and minor arcs exact, reverses arcs and reads a circle endpoint as a radius point", () => {
    const result = readBoard(
      board(
        [
          arc("0 0", "5 -5", "10 0"),
          line("0 0", "10 0"),
          circle("5 -2", "6 -2"),
        ].join(" "),
      ),
    );
    expect(result.outline[0]).toMatchObject({
      kind: "arc",
      centre: [5, 0],
      sweep: -Math.PI,
    });
    expect(result.cutouts[0]![0]).toMatchObject({
      kind: "arc",
      centre: [5, 2],
      from: [6, 2],
      to: [6, 2],
      sweep: -2 * Math.PI,
    });
    const major = readBoard(
      board(arc("1 0", "-1 0", "0 1") + line("1 0", "0 1")),
    );
    expect(
      Math.abs(major.outline[0]!.kind === "arc" ? major.outline[0]!.sweep : 0),
    ).toBeCloseTo(1.5 * Math.PI);
    const reversed = readBoard(
      board(line("0 0", "10 0") + arc("0 0", "5 -5", "10 0")),
    );
    expect(reversed.outline[1]).toMatchObject({
      kind: "arc",
      from: [10, 0],
      to: [0, 0],
      sweep: Math.PI,
    });
  });

  it("transforms every footprint graphic after local rotation, including back-side graphics already flipped by KiCad", () => {
    const graphics = [
      line("0 0", "4 0"),
      arc("4 0", "5 1", "4 2"),
      line("4 2", "0 2"),
      line("0 2", "0 0"),
    ]
      .join(" ")
      .replaceAll("gr_", "fp_");
    for (const side of ["F.Cu", "B.Cu"]) {
      const result = readBoard(
        board(
          `(footprint "fixture" (layer "${side}") (at 10 20 90) ${graphics})`,
        ),
      );
      expect(result.outline[0]!.from[0]).toBeCloseTo(10);
      expect(result.outline[0]!.from[1]).toBeCloseTo(-20);
      expect(result.outline[0]!.to[0]).toBeCloseTo(10);
      expect(result.outline[0]!.to[1]).toBeCloseTo(-16);
      expect(result.outline[1]).toMatchObject({ kind: "arc" });
    }
    const shape = readBoard(
      board(
        `(footprint "fixture" (at 10 20 180) ${rect("0 0", "6 6").replace("gr_", "fp_")} ${circle("2 2", "3 2").replace("gr_", "fp_")} ${poly(["4 4", "5 4", "5 5", "4 5"]).replace("gr_", "fp_")})`,
      ),
    );
    expect(shape.cutouts).toHaveLength(2);
    expect(shape.outline[0]!.from).toEqual([10, -20]);
    expect(shape.outline[0]!.to[0]).toBeCloseTo(4);
  });

  it("finds the outermost loop regardless of input order and winding", () => {
    const result = readBoard(
      board(
        circle("5 5", "6 5") + poly(["0 0", "0 10", "10 10", "10 0", "0 0"]),
      ),
    );
    expect(result.outline).toHaveLength(4);
    expect(result.cutouts).toHaveLength(1);
    expect(
      readBoard(board(circle("0 0", "10 0") + circle("0 0", "2 0"))).cutouts,
    ).toHaveLength(1);
    expect(
      readBoard(board(circle("0 0", "10 0") + circle("0 -5", "1 -5"))).cutouts,
    ).toHaveLength(1);
    expect(
      readBoard(
        board(
          arc("-10 0", "0 -10", "10 0") +
            line("10 0", "-10 0") +
            circle("0 -5", "1 -5"),
        ),
      ).cutouts,
    ).toHaveLength(1);
  });

  it("reads arcs inside writer polygon point lists", () => {
    const shape = `(gr_poly (pts (xy 0 0) (xy 10 0) (arc (start 10 0) (mid 15 5) (end 10 10)) (xy 0 10)) ${edge})`;
    const expected =
      line("0 0", "10 0") +
      arc("10 0", "15 5", "10 10") +
      line("10 10", "0 10") +
      line("0 10", "0 0");
    expect(readBoard(board(shape)).outline).toEqual(
      readBoard(board(expected)).outline,
    );
    const round = `(gr_poly (pts (arc (start 1 0) (mid 0 -1) (end -1 0)) (arc (start -1 0) (mid 0 1) (end 1 0))) ${edge})`;
    expect(readBoard(board(round)).outline).toHaveLength(2);
  });

  it("counts an arc tangent at a vertex once when its neighbour crosses the ray", () => {
    const outline =
      arc("0 5", "5 0", "0 -5") +
      line("0 -5", "-10 -5") +
      line("-10 -5", "-10 10") +
      line("-10 10", "0 5");
    expect(
      readBoard(board(outline + circle("-5 5", "-4 5"))).cutouts,
    ).toHaveLength(1);
  });

  it.each(["10 0", "0 10", "-10 0", "0 -10"])(
    "rejects disjoint circles regardless of the outer radius point %s",
    (end) => {
      for (const y of [-10, 10]) {
        const outer = circle("0 0", end);
        const outside = circle(`-20 ${y}`, `-19 ${y}`);
        expect(() => readBoard(board(outer + outside))).toThrow(
          /disjoint pieces/i,
        );
        expect(() => readBoard(board(outside + outer))).toThrow(
          /disjoint pieces/i,
        );
        expect(
          readBoard(board(outer + circle("0 0", "1 0"))).cutouts,
        ).toHaveLength(1);
      }
    },
  );

  it.each([
    poly(["0 0", "1e200 1e200", "0 1e200", "1e200 0"]),
    rect("0 0", "1e200 1e200"),
    `(footprint "fixture" (at 10 20 90) ${poly(["0 0", "1e200 1e200", "0 1e200", "1e200 0"]).replace("gr_", "fp_")})`,
    circle("0 0", "1e200 0"),
    arc("0 0", "1e100 1e-100", "2e100 0") + line("2e100 0", "0 0"),
    arc("0 0", "1e100 -1e100", "2e100 0") + line("2e100 0", "0 0"),
  ])("rejects overflowing derived geometry and recovers", (items) => {
    expect(() => readBoard(board(items))).toThrow(
      /geometry arithmetic.*range/i,
    );
    expect(readBoard(board(rect("0 0", "10 10"))).outline).toHaveLength(4);
  });

  it.each([
    [rect("0 0", "10 10") + rect("20 0", "30 10"), /disjoint pieces/i],
    [
      rect("0 0", "20 20") + rect("2 2", "18 18") + rect("5 5", "10 10"),
      /island in a cutout/i,
    ],
    [line("0 0", "10 0"), /open chain/i],
    [poly(["0 0", "10 10", "0 10", "10 0"]), /self.intersect/i],
    [poly(["0 0", "10 0", "5 0", "5 5", "0 5"]), /self.intersect/i],
    [rect("0 0", "10 10") + circle("10 5", "12 5"), /self.intersect/i],
    [circle("0 0", "5 0") + circle("8 0", "13 0"), /self.intersect/i],
    [circle("0 0", "5 0") + circle("0 0", "5 0"), /self.intersect/i],
    [rect("0 0", "10 10") + rect("2 2", "10 4"), /self.intersect/i],
    [
      line("0 0", "10 0") + line("10 0", "10 10") + line("10 0", "0 10"),
      /self.intersect/i,
    ],
    [
      arc("0 0", "5 -5", "10 0") + line("10 0", "5 -6") + line("5 -6", "0 0"),
      /self.intersect/i,
    ],
    [
      arc("0 0", "5 -5", "10 0") + arc("0 0", "5 -5", "10 0"),
      /self.intersect/i,
    ],
  ])("rejects malformed topology by name", (items, message) => {
    expect(() => readBoard(board(items))).toThrow(message);
  });

  it.each([
    ["(general (thickness 0))", /thickness/],
    ["(general (thickness NaN))", /thickness/],
    [
      '(general (thickness 1.6)) (setup (stackup (layer "F.Cu" (type "copper") (thickness -1))))',
      /stackup.*thickness/i,
    ],
    [
      '(general (thickness 1.6)) (setup (stackup (layer "dielectric 1" (type "core") (epsilon_r nope))))',
      /epsilon_r/,
    ],
  ])("validates thickness and stackup numbers", (header, message) => {
    expect(() =>
      readBoard(
        parseSexpr(
          `(kicad_pcb (version 20241229) ${header} ${rect("0 0", "10 10")})`,
        ),
      ),
    ).toThrow(message);
  });

  it.each([
    [line("0 0", "NaN 1"), /coordinate/],
    [rect("0 0", "1"), /coordinate/],
    [
      `(footprint "fixture" (at 0 nope 90) ${rect("0 0", "10 10").replace("gr_", "fp_")})`,
      /coordinate/,
    ],
    [line("0 0", "0 0"), /degenerate/],
    [line("0 0", "0.0005 0"), /degenerate/],
    [arc("0 0", "5 0", "10 0"), /degenerate arc/],
    [circle("0 0", "0 0"), /degenerate circle/],
    [poly(["0 0", "1 1"]), /polygon/],
    [`(gr_curve (pts (xy 0 0)) ${edge})`, /unsupported.*Edge.Cuts/],
  ])("rejects malformed Edge.Cuts without ignoring them", (items, message) => {
    expect(() => readBoard(board(items))).toThrow(message);
  });

  it("skips nets, non-edge graphics, origins and unknown fields without mutating the tree", () => {
    const tree = board(
      rect("0 0", "10 10") +
        '(net bad "ignored") (future (gr_line (layer "Edge.Cuts"))) (gr_circle (end bad) (layer "F.SilkS")) (footprint "empty" (pad "1" (net bad))) (setup (aux_axis_origin 999 999) (grid_origin 888 888) (future value))',
    );
    const original = JSON.stringify(tree);
    expect(readBoard(tree).outline).toEqual(
      readBoard(board(rect("0 0", "10 10"))).outline,
    );
    expect(readBoard(tree).stackup).toBeUndefined();
    expect(JSON.stringify(tree)).toBe(original);
    expect(() => readBoard(board('(net 1 "only nets")'))).toThrow(/outline/i);
  });

  it("bounds geometry work and recovers for the next board", () => {
    const many = Array.from({ length: BOARD_LIMITS.segments + 1 }, (_, i) =>
      line(`${i} 0`, `${i + 1} 0`),
    ).join(" ");
    expect(() => readBoard(board(many))).toThrow(/limit/i);
    expect(() =>
      readBoard(
        board(
          Array.from({ length: 1500 }, (_, i) =>
            circle(`${i * 10} 0`, `${i * 10 + 1} 0`),
          ).join(" "),
        ),
      ),
    ).toThrow(/work limit/i);
    expect(readBoard(board(rect("0 0", "10 10"))).outline).toHaveLength(4);
  });
});
