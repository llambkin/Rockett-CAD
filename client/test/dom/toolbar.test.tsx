import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Toolbar } from "../../src/components/Toolbar";
import { useStore } from "../../src/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("opens the Extrude dialog when its toolbar button is clicked", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Toolbar />));

  const extrude = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Extrude",
  );
  await act(async () => extrude!.click());

  expect(useStore.getState().mode).toEqual({
    name: "dialog",
    dialog: "extrude",
  });
  await act(async () => root.unmount());
});

it("offers no WebGL context", () => {
  const canvas = document.createElement("canvas");
  expect(canvas.getContext("webgl2")).toBeNull();
  expect(canvas.getContext("webgl")).toBeNull();
});
