import type { SketchFeature, SketchPoint } from "@rockett/shared";
import { activeCommand } from "../commands/active";
import { pushKeyContext, type KeyEvent } from "../commands/keymap";
import { selectionKey, useStore, type Selection } from "../store";
import type { CadViewport } from "../three/CadViewport";
import type { ClientBox } from "../three/boxPick";

export const IDLE_PICKS = [
  "design.face",
  "design.edge",
  "design.vertex",
  "sketch.profile",
  "sketch.entity",
  "sketch.point",
];
export const SKETCH_PICKS = ["sketch.entity", "sketch.point"];

const DRAG_START_PX = 4;

type UV = { x: number; y: number };
type Pointer = Pick<PointerEvent, "clientX" | "clientY">;
type Keys = Pick<PointerEvent, "shiftKey" | "ctrlKey" | "metaKey">;
type Line = { kind: "line"; from: UV; ends: SketchPoint[] };
type Gesture =
  | { kind: "box"; ids: readonly string[] }
  | Line
  | { kind: "point" }
  | { kind: "cancelled"; point: boolean };
interface Press {
  x: number;
  y: number;
  travelled: boolean;
  draft: SketchFeature | null;
  gesture: Gesture | null;
}
type Release = (e: PointerEvent, moved: boolean) => unknown;

function boxSelection(
  current: readonly Selection[],
  found: readonly Selection[],
  keys: Keys,
): Selection[] {
  const keyed = new Set(found.map(selectionKey));
  if (keys.ctrlKey || keys.metaKey)
    return current.filter((s) => !keyed.has(selectionKey(s)));
  if (!keys.shiftKey) return [...found];
  const had = new Set(current.map(selectionKey));
  return [...current, ...found.filter((s) => !had.has(selectionKey(s)))];
}

function lineGesture(entityId: string, from: UV | null): Line | null {
  const entities = useStore.getState().draftSketch?.entities ?? [];
  const line = entities.find((e) => e.id === entityId);
  if (!from || line?.kind !== "line" || line.external) return null;
  const ends = entities.filter(
    (e): e is SketchPoint =>
      e.kind === "point" &&
      !e.external &&
      (e.id === line.p1 || e.id === line.p2),
  );
  return ends.length === 2 ? { kind: "line", from, ends } : null;
}

function gestureAt(
  vp: CadViewport,
  e: PointerEvent,
  planeUV: (e: Pointer) => UV | null,
): Gesture | null {
  const s = useStore.getState();
  const tool = s.active?.id === "design.sketch" ? s.active.state.tool : "";
  if (activeCommand() || (s.active && tool !== "select")) return null;
  const ids = tool ? SKETCH_PICKS : IDLE_PICKS;
  const hit = vp.pick(e.clientX, e.clientY, ids)?.selection;
  if (!hit) return { kind: "box", ids };
  if (tool && hit.kind === "sketchPoint") return { kind: "point" };
  if (hit.kind === "sketchEntity") return lineGesture(hit.entityId, planeUV(e));
  return null;
}

function moveLine(g: Line, uv: UV | null) {
  const s = useStore.getState();
  if (!uv) return;
  const [dx, dy] = [uv.x - g.from.x, uv.y - g.from.y];
  for (const p of g.ends)
    s.solveDraft({ pointId: p.id, x: p.x + dx, y: p.y + dy });
}

function restore(draft: SketchFeature | null) {
  const s = useStore.getState();
  if (draft && s.draftSketch?.id === draft.id)
    s.updateDraftSketch(draft.entities, draft.constraints);
}

const span = (g: Pointer, e: Pointer): ClientBox => ({
  left: Math.min(g.clientX, e.clientX),
  right: Math.max(g.clientX, e.clientX),
  top: Math.min(g.clientY, e.clientY),
  bottom: Math.max(g.clientY, e.clientY),
});

function draw(
  outline: HTMLElement,
  container: HTMLElement,
  p: Press,
  e: Pointer,
) {
  const b = span({ clientX: p.x, clientY: p.y }, e);
  const at = container.getBoundingClientRect();
  outline.className = `select-box${e.clientX < p.x ? " crossing" : ""}`;
  Object.assign(outline.style, {
    left: `${b.left - at.left}px`,
    top: `${b.top - at.top}px`,
    width: `${b.right - b.left}px`,
    height: `${b.bottom - b.top}px`,
  });
  if (!outline.isConnected) container.append(outline);
}

function finish(vp: CadViewport, p: Press, e: PointerEvent) {
  const s = useStore.getState();
  if (p.gesture?.kind === "line") {
    const { draft } = p;
    void s.commitDraftSketch().catch(() => restore(draft));
    return;
  }
  if (p.gesture?.kind !== "box") return;
  const mode = e.clientX < p.x ? "crossing" : "window";
  const box = span({ clientX: p.x, clientY: p.y }, e);
  const found = vp.boxPick(box, mode, p.gesture.ids);
  s.setSelection(boxSelection(s.selection, found, e));
}

export function primaryDrag(
  vp: CadViewport,
  container: HTMLElement,
  planeUV: (e: Pointer) => UV | null,
) {
  let press: Press | null = null;
  let popKeys: (() => void) | null = null;
  const outline = document.createElement("div");
  const escape = (e: KeyEvent) => {
    const g = press?.gesture;
    if (e.key !== "Escape" || !press || !g || g.kind === "cancelled")
      return false;
    restore(press.draft);
    outline.remove();
    press.gesture = { kind: "cancelled", point: g.kind === "point" };
    return true;
  };
  const end = () => {
    press = null;
    outline.remove();
    popKeys?.();
    popKeys = null;
  };
  const cancel = () => {
    if (press?.travelled) restore(press.draft);
    end();
  };
  return {
    cancel,
    down(e: PointerEvent): boolean {
      cancel();
      const gesture = gestureAt(vp, e, planeUV);
      const draft = useStore.getState().draftSketch;
      press = { x: e.clientX, y: e.clientY, travelled: false, draft, gesture };
      if (gesture)
        popKeys = pushKeyContext({ kind: "overlay", handle: escape });
      return gesture?.kind === "box" || gesture?.kind === "line";
    },
    move(e: PointerEvent): boolean {
      const p = press;
      const g = p?.gesture;
      if (!p || !g) return false;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      p.travelled ||= far >= DRAG_START_PX;
      if (g.kind === "point") return !p.travelled;
      if (p.travelled && g.kind === "box") draw(outline, container, p, e);
      if (p.travelled && g.kind === "line") moveLine(g, planeUV(e));
      return true;
    },
    up(e: PointerEvent, moved: boolean, release: Release) {
      const p = press;
      end();
      const g = p?.gesture;
      if (!p || !g) release(e, moved);
      else if (g.kind === "point") release(e, p.travelled);
      else if (g.kind === "cancelled") {
        if (g.point) release(e, true);
      } else if (!p.travelled) release(e, false);
      else finish(vp, p, e);
    },
  };
}
