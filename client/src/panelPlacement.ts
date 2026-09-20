type Rect = { left: number; top: number; right: number; bottom: number };
export function panelPlacement(position: { x: number; y: number }, size: { width: number; height: number },
  viewport: { width: number; height: number }, cube?: Rect) {
  const clamp = (v: number, max: number) => Math.max(4, Math.min(max, v));
  const x = clamp(position.x, viewport.width - size.width - 4);
  const y = clamp(position.y, viewport.height - size.height - 4);
  if (!cube || x + size.width <= cube.left - 8 || x >= cube.right + 8 || y + size.height <= cube.top - 8 || y >= cube.bottom + 8) return { x, y };
  // Prefer alongside the cube; on narrow screens place below it.
  if (cube.left - size.width - 8 >= 4) return { x: cube.left - size.width - 8, y };
  return { x, y: cube.bottom + 8 };
}
