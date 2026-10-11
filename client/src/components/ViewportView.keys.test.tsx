import "../commands/design";
import "../features/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type SketchFeature } from "@rockett/shared";
import { ViewportView } from "./ViewportView";
import { installKeymap } from "../commands/keymap";
import { useStore } from "../store";
import {
  pointer,
  result,
  sceneViewport,
  sizeViewport,
  ViewportProbe,
} from "../../test/helpers/boxScene";
import { squareSketch } from "../../test/helpers/perfFixtures";
import { sketchState } from "../commands/sketch";

vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: (await import("../../test/helpers/fakeRenderer"))
    .FakeWebGLRenderer,
}));
vi.mock("../three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

const press = (
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = sceneViewport().renderer.domElement,
) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });

it.each(["line", "rect", "circle"] as const)(
  "dispatches %s dimension keys before sketch commands and restores native typing",
  async (tool) => {
    vi.useFakeTimers();
    const restoreSize = sizeViewport();
    const doc = createEmptyDocument("keys", "Sketch keys");
    const sketch: SketchFeature = {
      id: "sk",
      type: "sketch",
      suppressed: false,
      name: "Sketch",
      plane: { kind: "origin", plane: "XY" },
      entities: [],
      constraints: [],
    };
    doc.features = [sketch];
    doc.timelinePosition = 1;
    const commit = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    useStore.setState({
      projectId: doc.id,
      document: doc,
      draftSketch: sketch,
      evaluation: result(
        [],
        [
          {
            featureId: "sk",
            frame: squareSketch(0, 0).frame,
            entities: [],
            profiles: [],
            solveStatus: "unconstrained",
            dof: 0,
          },
        ],
      ),
      active: {
        id: "design.sketch",
        state: sketchState("sk", tool),
      },
      selection: [{ kind: "sketchPoint", sketchId: "sk", entityId: "keep" }],
      busy: false,
      error: null,
      commitDraftSketch: commit,
      deleteSketchEntities: remove,
    });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const dispose = installKeymap();
    try {
      await act(async () =>
        root.render(
          <ViewportView>
            {(viewport) => (
              <>
                {viewport}
                <ViewportProbe />
              </>
            )}
          </ViewportView>,
        ),
      );
      const vp = sceneViewport();
      vp.setView([0, 0, 1], [0, 1, 0], false);
      vp.render();
      await act(async () => {
        pointer("pointerdown", new THREE.Vector3(0, 0, 0));
        pointer("pointerup", new THREE.Vector3(0, 0, 0));
        pointer("pointermove", new THREE.Vector3(10, 5, 0));
        vi.advanceTimersToNextFrame();
      });
      const active = () => host.querySelector(".dim-field.active")!;
      expect(active()).not.toBeNull();
      await press("2", { isComposing: true });
      expect(active().classList.contains("locked")).toBe(false);
      await press("2", { ctrlKey: true });
      expect(active().classList.contains("locked")).toBe(false);
      const input = host.appendChild(document.createElement("input"));
      await press("2", {}, input);
      expect(active().classList.contains("locked")).toBe(false);
      await press("2");
      await press("2", { repeat: true });
      expect(active().textContent).toContain("22");
      await press("Backspace");
      for (const key of ["c", "m"]) await press(key);
      expect(active().textContent).toContain("2cm");
      expect(useStore.getState().active).toMatchObject({ state: { tool } });
      await press("Backspace");
      expect(active().textContent).toContain("2c");
      expect(remove).not.toHaveBeenCalled();
      await press("m");
      for (const key of ["Backspace", "Backspace", "Backspace"])
        await press(key);
      expect(active().classList.contains("locked")).toBe(false);
      expect(remove).not.toHaveBeenCalled();
      for (const key of ["2", "c", "m"]) await press(key);
      if (tool !== "circle") {
        await press("Tab");
        expect([...host.querySelectorAll(".dim-field")].indexOf(active())).toBe(
          1,
        );
        await press("Tab", { shiftKey: true });
        expect([...host.querySelectorAll(".dim-field")].indexOf(active())).toBe(
          0,
        );
      }
      if (tool === "line") {
        await press("a");
        expect(
          host.querySelectorAll(".dim-field")[1]!.classList.contains("locked"),
        ).toBe(true);
        await press("a", { repeat: true });
        expect(
          host.querySelectorAll(".dim-field")[1]!.classList.contains("locked"),
        ).toBe(true);
        await press("a");
        expect(
          host.querySelectorAll(".dim-field")[1]!.classList.contains("locked"),
        ).toBe(false);
      }
      await press("Enter");
      expect(commit).toHaveBeenCalledOnce();
      expect(useStore.getState().draftSketch?.constraints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: tool === "circle" ? "diameter" : "length",
            value: 20,
          }),
        ]),
      );
      expect(host.querySelector(".dim-field")).toBeNull();
      await act(async () => root.unmount());
      dispose();
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      await act(async () => root.unmount());
      dispose();
      host.remove();
      restoreSize();
      vi.useRealTimers();
    }
  },
);
