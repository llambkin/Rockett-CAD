import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { PANEL_MIN_PX } from "@rockett/shared";
import { resetSetting, setSetting, useSetting } from "../settings";
import { useStore } from "../store";

const VIEWPORT_MIN_PX = 320;
const KEY_STEP_PX = 16;
const ARROW_STEP: Record<string, number> = {
  ArrowLeft: -KEY_STEP_PX,
  ArrowRight: KEY_STEP_PX,
};

type PanelSetting = "ui.treeWidth";
type Drag = { x: number; width: number };

const panelMax = (room: number) =>
  Math.floor(Math.min(room / 2, room - VIEWPORT_MIN_PX));

const clampPanel = (width: number, room: number) =>
  Math.min(Math.max(Math.round(width), PANEL_MIN_PX), panelMax(room));

function onWindowResize(fn: () => void) {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
}

const report = (error: Error) => useStore.getState().setError(error.message);

export function useSplitter(setting: PanelSetting, label: string) {
  const room = useSyncExternalStore(onWindowResize, () => window.innerWidth);
  const saved = useSetting(setting);
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const width = clampPanel(draft ?? saved, room);

  const save = (from: number, next: number) => {
    if (next !== from) void setSetting(setting, next).catch(report);
  };
  const follow = (start: Drag, e: PointerEvent) =>
    clampPanel(start.width + e.clientX - start.x, room);

  const splitter = (
    <div
      className={`splitter ${draft === null ? "" : "dragging"}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN_PX}
      aria-valuemax={panelMax(room)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) setDraft(follow(drag.current, e));
      }}
      onPointerUp={(e) => {
        const start = drag.current;
        if (!start) return;
        drag.current = null;
        setDraft(null);
        save(start.width, follow(start, e));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraft(null);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        const step = ARROW_STEP[e.key];
        if (step === undefined) return;
        e.preventDefault();
        save(width, clampPanel(width + step, room));
      }}
      onDoubleClick={() => void resetSetting(setting, "user").catch(report)}
    />
  );
  return { width, splitter };
}
