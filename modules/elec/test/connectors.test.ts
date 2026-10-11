import { expect, it } from "vitest";
import { readBoard, readBoardNets } from "../../kicad/src/board.js";
import { parseSexpr } from "../../kicad/src/sexpr.js";
import { connectors, type ConnectorSnapshot } from "../src/connectors.js";

const tree = parseSexpr(`(kicad_pcb (version 20251028) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 40 40) (layer "Edge.Cuts"))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Horizontal" (layer "F.Cu")
    (uuid "00000000-0000-4000-8000-000000000001") (at 10 20)
    (property "Reference" "J1")
    (pad "1" thru_hole rect (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net "VBUS"))
    (pad "2" thru_hole oval (at 0 2.54) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net "GND")))
  (footprint "Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical" (layer "B.Cu")
    (uuid "00000000-0000-4000-8000-000000000002") (at 30 10 90)
    (property "Reference" "J2")
    (pad "1" thru_hole rect (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net "GND"))
    (pad "2" thru_hole oval (at 2.5 0) (size 1.7 1.7) (drill 1) (layers "*.Cu"))
    (pad "" np_thru_hole circle (at 1 -2) (size 1 1) (drill 1) (layers "*.Cu")))
  (footprint "Resistor_SMD:R_0603_1608Metric" (layer "F.Cu")
    (uuid "00000000-0000-4000-8000-000000000003") (at 5 5)
    (property "Reference" "R1")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net "GND")))
  (footprint "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" (layer "F.Cu")
    (uuid "00000000-0000-4000-8000-000000000004") (at 20 30)
    (property "Reference" "U1")
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net "VBUS"))))`);

const snapshot = (
  placement: ConnectorSnapshot["placement"],
): ConnectorSnapshot => ({
  ...readBoard(tree),
  nets: readBoardNets(tree),
  placement,
});
const near = (point: number[]) => point.map((value) => expect.closeTo(value));
const J1 = "00000000-0000-4000-8000-000000000001";
const U1 = "00000000-0000-4000-8000-000000000004";

it("a right-angle connector without a mating frame asserts no direction", () => {
  const listed = connectors(
    snapshot({ rotation: [0, 0, 0, 1], translation: [0, 0, 0] }),
    {},
  );
  expect(listed.map((connector) => connector.reference)).toEqual(["J1", "J2"]);
  expect(listed[0]).toEqual({
    footprintUuid: J1,
    reference: "J1",
    side: "front",
    suggested: near([0, 0, 1]),
    pins: [
      { pad: "1", net: "VBUS", position: near([10, -20, 1.6]) },
      { pad: "2", net: "GND", position: near([10, -22.54, 1.6]) },
    ],
  });
  expect(listed[0]).not.toHaveProperty("mating");
});

it("places pins through footprint and board placement and asserts direction only from library orientation or a user frame", () => {
  const half = Math.SQRT1_2;
  const listed = connectors(
    snapshot({ rotation: [0, 0, half, half], translation: [100, 0, 10] }),
    { [J1]: { mating: [1, 0, 0] }, [U1]: { connector: true } },
  );
  expect(listed).toEqual([
    expect.objectContaining({
      reference: "J1",
      mating: { direction: near([0, 1, 0]), source: "frame" },
    }),
    {
      footprintUuid: "00000000-0000-4000-8000-000000000002",
      reference: "J2",
      side: "back",
      suggested: near([0, 0, -1]),
      mating: { direction: near([0, 0, -1]), source: "metadata" },
      pins: [
        { pad: "1", net: "GND", position: near([110, 30, 10]) },
        { pad: "2", position: near([107.5, 30, 10]) },
      ],
    },
    {
      footprintUuid: U1,
      reference: "U1",
      side: "front",
      suggested: near([0, 0, 1]),
      pins: [{ pad: "1", net: "VBUS", position: near([130, 19, 11.6]) }],
    },
  ]);
});
