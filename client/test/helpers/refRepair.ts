import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type EdgeRef,
  type Feature,
  type FilletFeature,
} from "@rockett/shared";
import { api } from "../../src/api";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { openFeatureEditor } from "../../src/components/Timeline";
import { dropBase } from "../../src/previewBase";
import { useStore } from "../../src/store";
import { meshedBody } from "./meshedBody";
import { REPAIR_SIG } from "../../src/features/featureUi.apiMocks";
import "../../src/features/core";
import "../../src/commands/design";

export const edgeRef = (edgeName: string): EdgeRef => ({
  kind: "edge",
  bodyId: "b1",
  edgeName,
});
export const fillet: FilletFeature = {
  id: "fillet",
  type: "fillet",
  filletType: "equalDistance",
  name: "Fillet1",
  suppressed: false,
  radius: 1,
  tangentChain: false,
  edges: [edgeRef("gone")],
};
const initial = useStore.getState();
const edits: string[] = [];
export const server = {
  saved: createEmptyDocument("repair", "Repair"),
  previews: new Map<string, CadDocument>(),
  labels: () => [...edits],
};
export let host: HTMLElement;
let root: Root;

export function evaluate(doc: CadDocument) {
  return {
    bodies: [
      meshedBody({
        edges: ["e1", "e2", "e3"].map((name) => ({
          name,
          polyline: [0, 0, 0, 0, 0, 10],
          length: 10,
          curve: { type: "line" as const, a: [0, 0, 0], b: [0, 0, 10] },
        })),
      }),
    ],
    sketches: [],
    planes: [],
    kernelMs: 0,
    featureStatuses: doc.features.map((f) => ({
      featureId: f.id,
      status: "error" as const,
      refs: [
        {
          ref: edgeRef("gone"),
          status: "candidate" as const,
          candidates: [
            { bodyId: "b1", name: "e3", basis: "signature" as const },
          ],
          suggestions: [],
        },
      ],
    })),
  };
}

const reply = (doc = server.saved) => ({
  document: structuredClone(doc),
  evaluation: evaluate(doc),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  server.previews.clear();
  edits.length = 0;
  vi.mocked(api.evaluate).mockImplementation(async () =>
    evaluate(server.saved),
  );
  vi.mocked(api.updateFeature).mockImplementation(
    async (_id, fid, patch, _position, tx, seq) => {
      const doc = structuredClone(server.saved);
      doc.features = doc.features.map((f) =>
        f.id === fid ? ({ ...f, ...patch } as Feature) : f,
      );
      for (const feature of doc.features)
        if (feature.type === "fillet")
          feature.edges = feature.edges.map((edge) =>
            edge.kind === "edge" && edge.edgeName === "e3"
              ? { ...edge, sig: REPAIR_SIG }
              : edge,
          );
      if (seq !== undefined && tx) server.previews.set(tx, doc);
      else {
        doc.revision++;
        server.saved = doc;
        edits.push("Edit Fillet1");
      }
      return reply(doc);
    },
  );
  vi.mocked(api.commitPreview).mockImplementation(async (_id, tx) => {
    server.saved = server.previews.get(tx)!;
    server.saved.revision++;
    server.previews.delete(tx);
    edits.push("Edit Fillet1");
    return reply();
  });
  vi.mocked(api.abortPreview).mockImplementation(async (_id, tx) => {
    server.previews.delete(tx);
    return reply();
  });
});

export async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

export async function edit(feature: Feature) {
  dropBase();
  server.saved = createEmptyDocument("repair", "Repair");
  server.saved.features = [structuredClone(feature)];
  server.saved.timelinePosition = 1;
  useStore.setState(
    {
      ...initial,
      projectId: server.saved.id,
      document: structuredClone(server.saved),
      evaluation: evaluate(server.saved),
      active: null,
    },
    true,
  );
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(createElement(FeatureDialog)));
  await act(async () => openFeatureEditor(feature));
  await wait(0);
  vi.mocked(api.evaluate).mockClear();
}

export const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  dropBase();
  useStore.setState(initial, true);
  vi.useRealTimers();
});
