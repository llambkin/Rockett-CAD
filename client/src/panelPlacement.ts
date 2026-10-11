type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
const MARGIN = 4;

export function panelSize(size: Size, viewport: Size): Size {
  const fit = (v: number, room: number) =>
    Math.max(0, Math.min(room - 2 * MARGIN, v));
  return {
    width: fit(size.width, viewport.width),
    height: fit(size.height, viewport.height),
  };
}

export function panelPlacement(
  position: { x: number; y: number },
  size: Size,
  viewport: Size,
  cube?: Rect,
) {
  const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(max, v));
  const x = clamp(position.x, viewport.width - size.width - MARGIN);
  const y = clamp(position.y, viewport.height - size.height - MARGIN);
  if (
    !cube ||
    x + size.width <= cube.left - 8 ||
    x >= cube.right + 8 ||
    y + size.height <= cube.top - 8 ||
    y >= cube.bottom + 8
  )
    return { x, y };
  // Prefer alongside the cube; on narrow screens place below it.
  if (cube.left - size.width - 8 >= MARGIN)
    return { x: cube.left - size.width - 8, y };
  return { x, y: cube.bottom + 8 };
}
