import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readBoard, BOARD_LIMITS } from "../src/board.js";
import { parseSexpr } from "../src/sexpr.js";

const fixture = (version: number) =>
  parseSexpr(
    readFileSync(
      new URL(`fixtures/footprints-kicad${version}.kicad_pcb`, import.meta.url),
      "utf8",
    ),
  );
const read = (items: string) =>
  readBoard(
    parseSexpr(
      `(kicad_pcb (version 20241229) (general (thickness 1.6)) (gr_rect (start 0 0) (end 100 100) (layer "Edge.Cuts")) ${items})`,
    ),
  );
const footprint = (items: string) =>
  `(footprint "Fixture:Part" (layer "F.Cu") (at 0 0) ${items})`;

describe("board footprint reader", () => {
  it("keeps serialized pad angles at footprint angle 180 in both format fixtures", () => {
    for (const version of [9, 10]) {
      const [front, back, missing] = readBoard(fixture(version)).footprints;
      expect(front).toMatchObject({
        uuid: "00000000-0000-4000-8000-000000000001",
        libId: "Fixture:Front",
        reference: "J1",
        value: "Connector",
        side: "front",
        x: 20,
        y: -30,
        angle: 180,
        attributes: [
          "through_hole",
          "dnp",
          "exclude_from_bom",
          "future_attribute",
        ],
      });
      expect(front!.pads.map((pad) => pad.angle)).toEqual([15, -45, 0, 7]);
      expect(front!.pads[0]).toMatchObject({
        number: "1",
        type: "thru_hole",
        x: 18,
        y: -27,
        shapeOffset: [0.4, -0.2],
        drill: { shape: "oval", width: 1, height: 2 },
      });
      expect(front!.pads[1]).toMatchObject({
        number: "2",
        type: "np_thru_hole",
        x: 22,
        y: -29,
        drill: { shape: "round", width: 3.2, height: 3.2 },
      });
      expect(front!.pads[2]!.drill).toEqual({
        shape: "oval",
        width: 1.1,
        height: 1.1,
      });
      expect(front!.pads[3]!.drill).toBeUndefined();
      expect(front!.pads[3]!.shapeOffset).toEqual([0.3, 0.1]);
      expect(front!.courtyard!.min[0]).toBeCloseTo(14);
      expect(front!.courtyard!.min[1]).toBeCloseTo(-32);
      expect(front!.courtyard!.max[0]).toBeCloseTo(21);
      expect(front!.courtyard!.max[1]).toBeCloseTo(-26);
      expect(back).toMatchObject({
        side: "back",
        x: 50,
        y: -60,
        angle: 90,
        attributes: ["smd"],
      });
      expect(back!.pads[0]).toMatchObject({ x: 51, y: -58, angle: -30 });
      expect(back!.courtyard).toEqual({ min: [51, -60], max: [53, -56] });
      expect(missing!.courtyard).toBeUndefined();
      expect(front!.models).toEqual([
        {
          path: "${KIPRJMOD}/models/fixture.step",
          offset: [1, -2, 0.25],
          scale: [1, 2, -1],
          rotate: [10, 20, 30],
        },
        {
          path: "${KICAD9_3DMODEL_DIR}/fixture.wrl",
          offset: [0, 0, 0],
          scale: [1, 1, 1],
          rotate: [0, 0, 0],
        },
      ]);
    }
  });

  it("keeps source data unchanged and identity stable when Reference changes", () => {
    const tree = fixture(9),
      original = JSON.stringify(tree);
    const first = readBoard(tree).footprints[0]!;
    expect(JSON.stringify(tree)).toBe(original);
    const renamed = readBoard(
      parseSexpr(
        readFileSync(
          new URL("fixtures/footprints-kicad9.kicad_pcb", import.meta.url),
          "utf8",
        ).replace('"J1"', '"J7"'),
      ),
    ).footprints[0]!;
    expect(renamed.reference).toBe("J7");
    expect(renamed.uuid).toBe(first.uuid);
    expect(renamed.pads).toEqual(first.pads);
    expect(read("(via (at bad) (drill bad))").footprints).toEqual([]);
  });

  it("bounds arcs, circles, polygons and lines without requiring a closed courtyard", () => {
    for (const graphics of [
      '(fp_arc (start 1 0) (mid 0 -1) (end -1 0) (layer "F.CrtYd"))',
      '(fp_poly (pts (arc (start 1 0) (mid 0 -1) (end -1 0)) (xy 1 0)) (layer "F.CrtYd"))',
    ]) {
      const result = read(footprint(graphics)).footprints[0]!.courtyard!;
      expect(result.min[0]).toBeCloseTo(-1);
      expect(result.min[1]).toBeCloseTo(0);
      expect(result.max[0]).toBeCloseTo(1);
      expect(result.max[1]).toBeCloseTo(1);
    }
    expect(
      read(
        footprint(
          '(fp_arc (start 1 0) (mid -1 0) (end 0 -1) (layer "F.CrtYd"))',
        ),
      ).footprints[0]!.courtyard,
    ).toEqual({ min: [-1, -1], max: [1, 1] });
    expect(
      read(footprint('(fp_circle (center 2 3) (end 4 3) (layer "F.CrtYd"))'))
        .footprints[0]!.courtyard,
    ).toEqual({ min: [0, -5], max: [4, -1] });
    expect(
      read(footprint('(fp_line (start -2 1) (end 3 4) (layer "F.CrtYd"))'))
        .footprints[0]!.courtyard,
    ).toEqual({ min: [-2, -4], max: [3, -1] });
    expect(
      read(
        footprint(
          '(fp_poly (pts (xy 0 0) (xy 2 0) (xy 2 3)) (layer "F.CrtYd"))',
        ),
      ).footprints[0]!.courtyard,
    ).toEqual({ min: [0, -3], max: [2, 0] });
  });

  it.each([
    ["(at nope 0)", /placement|coordinate/],
    ["(at 0 0 nope)", /placement|coordinate/],
    ['(pad "1" thru_hole circle (at 0 nope) (drill 1))', /coordinate/],
    ['(pad "1" thru_hole circle (at 0 0 NaN) (drill 1))', /angle/],
    ['(pad "1" thru_hole circle (at 0 0) (drill -1))', /drill/],
    ['(pad "1" thru_hole circle (at 0 0) (drill oval 1 nope))', /drill/],
    [
      '(pad "1" thru_hole circle (at 0 0) (drill oval 1 2 (offset 0 nope)))',
      /offset/,
    ],
    ['(model "")', /path/],
    ['(model "bad\\npath.step")', /path/],
    ['(model "fixture.step" (at (xyz 1 2 3)))', /legacy.*offset/],
    ['(model "fixture.step" (offset (xyz 1 2)))', /offset/],
    ['(model "fixture.step" (scale (xyz 1 NaN 1)))', /scale/],
    ['(model "fixture.step" (rotate (xyz 1 2 1e400)))', /rotate/],
    ['(fp_line (start 0 0) (end NaN 1) (layer "F.CrtYd"))', /coordinate/],
    ['(fp_curve (pts (xy 0 0)) (layer "F.CrtYd"))', /unsupported/],
  ])("refuses malformed read fields and recovers: %s", (items, message) => {
    const data = items.startsWith("(at")
      ? `(footprint "Fixture:Part" (layer "F.Cu") ${items})`
      : footprint(items);
    expect(() => read(data)).toThrow(message);
    expect(read(footprint("")).footprints).toHaveLength(1);
  });

  it("bounds footprint traversal using the reader work budget", () => {
    const attrs = Array.from(
      { length: BOARD_LIMITS.work },
      () => "future",
    ).join(" ");
    expect(() => read(footprint(`(attr ${attrs})`))).toThrow(/work limit/);
    expect(read(footprint("")).footprints).toHaveLength(1);
  });
});
