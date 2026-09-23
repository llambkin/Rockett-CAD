import { describe, expect, it } from "vitest";
import {
  gestureZoomFactor,
  wheelGesture,
  wheelPan,
  wheelZoomFactor,
  type WheelInput,
} from "../src/three/wheel";

function wheel(patch: Partial<WheelInput>): WheelInput {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    shiftKey: false,
    timeStamp: 0,
    ...patch,
  };
}

describe("wheelZoomFactor", () => {
  it("zooms one 1.12 step per mouse notch", () => {
    expect(wheelZoomFactor(wheel({ deltaY: 100 }))).toBeCloseTo(1.12, 6);
    expect(wheelZoomFactor(wheel({ deltaY: -100 }))).toBeCloseTo(1 / 1.12, 6);
    expect(wheelZoomFactor(wheel({ deltaY: 4.000244140625 }))).toBeCloseTo(
      1.12,
      6,
    );
    expect(wheelZoomFactor(wheel({ deltaX: 100, shiftKey: true }))).toBeCloseTo(
      1.12,
      6,
    );
    expect(wheelZoomFactor(wheel({ deltaY: 0 }))).toBe(1);
  });

  it("converts lines and pages to pixels", () => {
    expect(wheelZoomFactor(wheel({ deltaY: 3, deltaMode: 1 }))).toBeCloseTo(
      1.12,
      6,
    );
    expect(wheelZoomFactor(wheel({ deltaY: -3, deltaMode: 1 }))).toBeCloseTo(
      1 / 1.12,
      6,
    );
    expect(
      wheelZoomFactor(wheel({ deltaY: 0.02, deltaMode: 2, ctrlKey: true })),
    ).toBeCloseTo(Math.exp(0.16), 6);
    expect(wheelPan(wheel({ deltaX: 1, deltaY: -2, deltaMode: 1 }))).toEqual([
      -100 / 3,
      200 / 3,
    ]);
  });

  it("takes the step and inversion that SET-016 will set", () => {
    expect(wheelZoomFactor(wheel({ deltaY: 100 }), 1.05)).toBeCloseTo(1.05, 6);
    expect(wheelZoomFactor(wheel({ deltaY: 100 }), 1.12, true)).toBeCloseTo(
      1 / 1.12,
      6,
    );
  });

  it("follows a pinch stream smoothly and clamps a spike", () => {
    const deltas = Array.from(
      { length: 20 },
      (_, i) => -(1.5 + Math.sin(i) * 1.2),
    );
    let total = 1;
    for (const deltaY of deltas) {
      const factor = wheelZoomFactor(wheel({ deltaY, ctrlKey: true }));
      expect(factor).toBeLessThanOrEqual(1.25);
      expect(factor).toBeGreaterThanOrEqual(1 / 1.25);
      expect(Math.abs(Math.log(factor))).toBeLessThan(Math.log(1.03));
      total *= factor;
    }
    const sum = deltas.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(Math.exp(sum * 0.01), 9);
    expect(total).toBeLessThan(0.75);
    expect(wheelZoomFactor(wheel({ deltaY: 400, ctrlKey: true }))).toBeCloseTo(
      1.25,
      9,
    );
    expect(wheelZoomFactor(wheel({ deltaY: 900 }))).toBeCloseTo(1.25, 9);
  });

  it("zooms by the ratio of Safari gesture scales", () => {
    expect(gestureZoomFactor(1, 1.1)).toBeCloseTo(1 / 1.1, 9);
    expect(gestureZoomFactor(1.1, 1)).toBeCloseTo(1.1, 9);
    expect(gestureZoomFactor(1, 3)).toBeCloseTo(1 / 1.25, 9);
    expect(gestureZoomFactor(1, 0)).toBe(1);
  });
});

describe("wheelGesture", () => {
  it("pans a trackpad scroll with the content following the fingers", () => {
    const gesture = wheelGesture();
    const scroll = wheel({ deltaX: 3, deltaY: -5.5 });
    expect(gesture.classify(scroll)).toBe("pan");
    expect(wheelPan(scroll)).toEqual([-3, 5.5]);
  });

  it("keeps one gesture sticky and resets after 150 ms idle", () => {
    const gesture = wheelGesture();
    const kinds = [
      wheel({ deltaY: 2, timeStamp: 0 }),
      wheel({ deltaY: 120, timeStamp: 16 }),
      wheel({ deltaY: 100, timeStamp: 160 }),
      wheel({ deltaY: 100, timeStamp: 400 }),
      wheel({ deltaX: 2, deltaY: 1, timeStamp: 450 }),
      wheel({ deltaX: 2, deltaY: 1, timeStamp: 601 }),
    ].map((e) => gesture.classify(e));
    expect(kinds).toEqual(["pan", "pan", "pan", "zoom", "zoom", "pan"]);
  });

  it("tells a mouse notch from a trackpad scroll", () => {
    const first = (patch: Partial<WheelInput>) =>
      wheelGesture().classify(wheel(patch));
    expect(first({ deltaY: 100 })).toBe("zoom");
    expect(first({ deltaY: 53 })).toBe("zoom");
    expect(first({ deltaY: 3, deltaMode: 1 })).toBe("zoom");
    expect(first({ deltaY: 4.000244140625 })).toBe("zoom");
    expect(first({ deltaX: 100, shiftKey: true })).toBe("zoom");
    expect(first({ deltaY: 4 })).toBe("pan");
    expect(first({ deltaY: 0.5 })).toBe("pan");
    expect(first({ deltaX: -2 })).toBe("pan");
  });

  it("zooms on every ctrl wheel and reports the pinch for Safari", () => {
    const gesture = wheelGesture();
    expect(gesture.classify(wheel({ deltaY: 2, timeStamp: 0 }))).toBe("pan");
    expect(
      gesture.classify(wheel({ deltaY: 1.5, ctrlKey: true, timeStamp: 10 })),
    ).toBe("pinch");
    expect(gesture.pinching(100)).toBe(true);
    expect(gesture.classify(wheel({ deltaY: 2, timeStamp: 120 }))).toBe("pan");
    expect(gesture.pinching(130)).toBe(false);
    gesture.classify(wheel({ deltaY: 1, ctrlKey: true, timeStamp: 200 }));
    expect(gesture.pinching(351)).toBe(false);
  });
});
