import { expect, it } from "vitest";
import { idleActionFor, sketchToolFor, withKey } from "../src/shortcuts";

it("maps idle keys to Fusion 360 defaults", () => {
  expect(idleActionFor("m")).toEqual({ kind: "dialog", dialog: "move" });
  expect(idleActionFor("i")).toEqual({ kind: "measure" });
  expect(idleActionFor("s")).toEqual({ kind: "sketch" });
  expect(idleActionFor("e")).toEqual({ kind: "dialog", dialog: "extrude" });
  expect(idleActionFor("f")).toEqual({ kind: "dialog", dialog: "fillet" });
  expect(idleActionFor("q")).toBeUndefined();
});

it("maps sketch keys to tools", () => {
  expect(sketchToolFor("p")).toBe("point");
  expect(sketchToolFor("x")).toBeUndefined();
});

it("labels tooltips from the same table", () => {
  expect(withKey("Move bodies", "move")).toBe("Move bodies (M)");
  expect(withKey("Measure", "measure")).toBe("Measure (I)");
  expect(withKey("Point", "point")).toBe("Point (P)");
  expect(withKey("Chamfer edges", "chamfer")).toBe("Chamfer edges");
});
