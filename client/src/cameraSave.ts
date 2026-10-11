import { TIMING_MS } from "./tunables";

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => void) | undefined;

export function dropCameraSave(): void {
  clearTimeout(timer);
  pending = undefined;
}

export function flushCameraSave(): void {
  const send = pending;
  dropCameraSave();
  send?.();
}

export function scheduleCameraSave(send: () => void): void {
  dropCameraSave();
  pending = send;
  timer = setTimeout(flushCameraSave, TIMING_MS.viewSave);
}
