import { expect, it } from "vitest";
import { panelPlacement } from "../src/panelPlacement";

const cube = { left: 880, right: 988, top: 100, bottom: 208 };
it("moves a saved panel position beside the view cube", () => {
  const p = panelPlacement(
    { x: 725, y: 100 },
    { width: 265, height: 350 },
    { width: 1000, height: 700 },
    cube,
  );
  expect(p.x + 265).toBeLessThanOrEqual(cube.left - 8);
});
it("places a panel below the cube when the screen is too narrow", () => {
  const p = panelPlacement(
    { x: 4, y: 20 },
    { width: 265, height: 350 },
    { width: 300, height: 700 },
    { left: 182, right: 290, top: 20, bottom: 128 },
  );
  expect(p.y).toBe(136);
});
it("preserves a safe dragged position and clamps after a window resize", () => {
  expect(
    panelPlacement(
      { x: 20, y: 30 },
      { width: 265, height: 350 },
      { width: 1000, height: 700 },
      cube,
    ),
  ).toEqual({ x: 20, y: 30 });
  expect(
    panelPlacement(
      { x: 1500, y: 900 },
      { width: 265, height: 350 },
      { width: 1000, height: 700 },
      cube,
    ),
  ).toEqual({ x: 731, y: 346 });
});
