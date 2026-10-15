export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
}

export type WheelKind = "pinch" | "pan" | "zoom";

const NOTCH_PX = 100;
const LINE_PX = NOTCH_PX / 3;
const PAGE_PX = 800;
const PINCH_GAIN = 0.01;
const MAX_EVENT_FACTOR = 1.25;
const GESTURE_IDLE_MS = 150;
const TRACKPAD_MAX_PX = 40;
const MAC_MOUSE_PX = 4.000244140625;

function pixels(delta: number, deltaMode: number) {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * PAGE_PX;
  return delta;
}

function clampedFactor(exponent: number) {
  const limit = Math.log(MAX_EVENT_FACTOR);
  return Math.exp(Math.max(-limit, Math.min(limit, exponent)));
}

export function wheelZoomFactor(
  e: Pick<WheelInput, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">,
  step = 1.12,
  invert = false,
) {
  const px = pixels(e.deltaY || e.deltaX, e.deltaMode);
  if (e.ctrlKey) return clampedFactor(px * PINCH_GAIN);
  const notches = (Math.sign(px) * Math.max(Math.abs(px), NOTCH_PX)) / NOTCH_PX;
  return clampedFactor((invert ? -notches : notches) * Math.log(step));
}

export function wheelPan(
  e: Pick<WheelInput, "deltaX" | "deltaY" | "deltaMode">,
): [number, number] {
  return [-pixels(e.deltaX, e.deltaMode), -pixels(e.deltaY, e.deltaMode)];
}

export function gestureZoomFactor(previousScale: number, scale: number) {
  if (!(previousScale > 0 && scale > 0)) return 1;
  return clampedFactor(Math.log(previousScale / scale));
}

function looksLikeTrackpad(e: WheelInput) {
  if (e.deltaMode !== 0 || e.shiftKey) return false;
  if (e.deltaX !== 0) return true;
  const y = Math.abs(e.deltaY);
  return y > 0 && y < TRACKPAD_MAX_PX && y % MAC_MOUSE_PX !== 0;
}

export function wheelGesture() {
  let kind: WheelKind = "zoom";
  let last = -Infinity;
  return {
    classify(e: WheelInput): WheelKind {
      const fresh = e.timeStamp - last > GESTURE_IDLE_MS;
      last = e.timeStamp;
      if (e.ctrlKey) kind = "pinch";
      else if (fresh || kind === "pinch")
        kind = looksLikeTrackpad(e) ? "pan" : "zoom";
      return kind;
    },
    pinching(now: number) {
      return kind === "pinch" && now - last <= GESTURE_IDLE_MS;
    },
  };
}

interface WheelTarget {
  queueZoom(factor: number, clientX: number, clientY: number): void;
  queuePan(dx: number, dy: number): void;
}

type SafariGesture = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

export function listenWheel(el: HTMLElement, vp: WheelTarget) {
  const gesture = wheelGesture();
  let gestureScale = 1;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (gesture.classify(e) === "pan") vp.queuePan(...wheelPan(e));
    else vp.queueZoom(wheelZoomFactor(e), e.clientX, e.clientY);
  };
  const onGesture = (e: Event) => {
    e.preventDefault();
    const g = e as SafariGesture;
    if (e.type === "gesturechange" && !gesture.pinching(e.timeStamp))
      vp.queueZoom(
        gestureZoomFactor(gestureScale, g.scale),
        g.clientX,
        g.clientY,
      );
    gestureScale = g.scale;
  };
  const gestures = ["gesturestart", "gesturechange", "gestureend"];
  el.addEventListener("wheel", onWheel, { passive: false });
  for (const type of gestures) el.addEventListener(type, onGesture);
  return () => {
    el.removeEventListener("wheel", onWheel);
    for (const type of gestures) el.removeEventListener(type, onGesture);
  };
}
