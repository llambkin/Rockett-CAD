import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  solveSketch,
  type SketchFeature,
} from "@rockett/shared";
import { useStore } from "../store";
import { api } from "../api";
import { SketchStatus } from "./SketchStatus";

vi.mock("../api", () => ({ api: { updateFeature: vi.fn() } }));

it("warns after a conflict-clearing deletion, preserves points and clears on the solving edit", async () => {
  const sketch: SketchFeature = {
    id: "sk",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 10, y: 0 },
      { id: "line", kind: "line", p1: "a", p2: "b" },
    ],
    constraints: [
      { id: "short", type: "length", line: "line", value: 20 },
      { id: "long", type: "length", line: "line", value: 30 },
    ],
  };
  const doc = createEmptyDocument("fixture", "Fixture");
  doc.features = [sketch];
  vi.mocked(api.updateFeature).mockImplementation(async (_id, _fid, patch) => {
    const document = useStore.getState().document!;
    const updated = { ...document.features[0], ...patch } as SketchFeature;
    const solved = solveSketch(updated);
    return {
      document: { ...document, features: [updated] },
      evaluation: {
        ...useStore.getState().evaluation!,
        sketches: [
          {
            ...useStore.getState().evaluation!.sketches[0]!,
            entities: updated.entities,
            dof: solved.dof,
            solveStatus: solved.status,
          },
        ],
      },
    };
  });
  useStore.setState({
    document: doc,
    draftSketch: sketch,
    active: {
      id: "design.sketch",
      state: {
        sketchId: "sk",
        tool: "select",
        constructionMode: false,
        polygonSides: 6,
      },
    },
    evaluation: {
      bodies: [],
      planes: [],
      kernelMs: 0,
      featureStatuses: [],
      sketches: [
        {
          frame: {
            origin: [0, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
          },
          featureId: "sk",
          entities: sketch.entities,
          profiles: [],
          dof: 3,
          solveStatus: "over_constrained",
        },
      ],
    },
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SketchStatus />));
    expect(host.textContent).toContain("Over-constrained!");
    expect(host.textContent).not.toContain("Sketch will settle");
    await act(async () => {
      useStore
        .getState()
        .updateDraftSketch(sketch.entities, sketch.constraints.slice(0, 1));
      await useStore.getState().commitDraftSketch();
    });
    expect(api.updateFeature).toHaveBeenCalledTimes(1);
    expect(useStore.getState().draftSketch!.entities).toEqual(sketch.entities);
    expect(host.textContent).toContain("Partially constrained (3 DOF)");
    expect(host.textContent).toContain("Sketch will settle at the next edit.");
    await act(async () =>
      useStore
        .getState()
        .updateDraftSketch(sketch.entities, [
          { id: "short", type: "length", line: "line", value: 25 },
        ]),
    );
    expect(useStore.getState().draftSketch!.entities).not.toEqual(
      sketch.entities,
    );
    expect(host.textContent).not.toContain("Sketch will settle");
    expect(host.querySelectorAll(".sketch-status")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
