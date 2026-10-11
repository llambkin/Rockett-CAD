import { ViewportContext } from "../viewportRef";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  createEmptyDocument,
  emptyView,
  nextFeatureName,
  type MeshedBody,
  type CadDocument,
  type SketchEntity,
  type SketchPayload,
} from "@rockett/shared";
import { api } from "../api";
import { ModelTree } from "../components/ModelTree";

import { useStore, type Selection } from "../store";
import { sceneViewport } from "../../test/helpers/boxScene";

import {
  box,
  mountScene,
  pointer,
  result,
  S,
  sizeViewport,
  unmountScene,
  wait,
  type P,
} from "../../test/helpers/boxScene";

const DX = 20;

function second(): MeshedBody {
  const body = box("second");
  body.bodyId = "b2";
  body.name = "Body2";
  body.positions = body.positions.map((v, i) => (i % 3 === 0 ? v + DX : v));
  body.edges = [];
  body.bbox = { min: [DX, 0, 0], max: [DX + S, S, S] };
  const front = body.faces.find((f) => f.name === "front")!;
  front.surface = {
    type: "cylinder",
    origin: [DX, 0, 0],
    axis: [0, 0, 1],
    radius: 5,
  };
  return body;
}

const sketch: SketchPayload = {
  featureId: "s1",
  frame: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  entities: [],
  solveStatus: "fully_constrained",
  dof: 0,
  profiles: [
    {
      id: "p1",
      outer: [],
      holes: [],
      polygon: [4, 4, 8, 4, 8, 8, 4, 8],
      holePolygons: [],
      area: 16,
    },
  ],
};
export const pathCurves: SketchEntity[] = [
  { id: "a", kind: "point", x: 0, y: -8 },
  { id: "b", kind: "point", x: 10, y: -8 },
  { id: "l1", kind: "line", p1: "a", p2: "b" },
];
export const path: SketchPayload = {
  ...sketch,
  featureId: "s2",
  entities: pathCurves,
  profiles: [],
};
export const onPath: P = [5, -8, 0];
export const nearPathEnd: P = [0.1, -8, 0];
export const region: Selection = {
  kind: "profile",
  sketchId: "s1",
  profileId: "p1",
};
export const topOf1: P = [5, 5, S];
export const topOf2: P = [DX + 5, 5, S];
export const roundOf2: P = [DX + 5, 0, 5];
export const scene = () => result([box("box"), second()], [sketch, path]);

export let server: CadDocument;
let restoreSize: () => void;
let treeRoot: Root | null = null;
let treeHost: HTMLElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  restoreSize = sizeViewport();
  server = createEmptyDocument("proj", "doc");
  server.features.push({
    id: "s1",
    type: "sketch",
    name: "Sketch1",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [],
    constraints: [],
  });
  server.features.push({
    id: "s2",
    type: "sketch",
    name: "Sketch2",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: structuredClone(pathCurves),
    constraints: [],
  });
  server.timelinePosition = 2;
  const reply = async () => ({
    document: structuredClone(server),
    evaluation: structuredClone(scene()),
  });
  vi.mocked(api.evaluate).mockImplementation(async () =>
    structuredClone(scene()),
  );
  vi.mocked(api.addFeature).mockImplementation(async (_id, feature) => {
    const added = structuredClone(feature);
    if (!added.name) added.name = nextFeatureName(server, added.type);
    server.features.push(added);
    server.timelinePosition = server.features.length;
    return reply();
  });
  vi.mocked(api.updateFeature).mockImplementation(async (_id, fid, patch) => {
    server.features = server.features.map((f) =>
      f.id === fid ? ({ ...f, ...patch } as typeof f) : f,
    );
    return reply();
  });
});

afterEach(async () => {
  await act(async () => treeRoot?.unmount());
  treeRoot = null;
  treeHost?.remove();
  treeHost = null;
  await unmountScene();
  vi.useRealTimers();
  restoreSize();
});

export async function open(
  active: ReturnType<typeof useStore.getState>["active"],
  selection: Selection[] = [],
) {
  const host = await mountScene({
    projectId: server.id,
    document: structuredClone(server),
    evaluation: structuredClone(scene()),
    view: emptyView(),
    selection,
    pickInput: null,
    active,
  });
  treeHost = document.body.appendChild(document.createElement("div"));
  treeRoot = createRoot(treeHost);
  await act(async () =>
    treeRoot!.render(
      <ViewportContext value={{ current: sceneViewport() }}>
        <ModelTree />
      </ViewportContext>,
    ),
  );
  const vp = sceneViewport();
  vp.setView([1, -1, 0.6], [0, 0, 1], false);
  vp.render();
  await wait(0);
  return host;
}

export const pickRow = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLElement>(".sel-info")].find(
    (el) => el.querySelector("span")?.textContent === label,
  );

export const activeRows = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>(".sel-info")]
    .filter((el) => el.getAttribute("aria-pressed") === "true")
    .map((el) => el.querySelector("span")?.textContent);

export async function activate(host: HTMLElement, label: string) {
  const row = pickRow(host, label);
  expect(row, label).toBeDefined();
  await act(async () => row!.click());
  await wait(0);
}

export async function clickAt(world: P, init: PointerEventInit = {}) {
  await act(async () => {
    pointer("pointerdown", new THREE.Vector3(...world), init);
    pointer("pointerup", new THREE.Vector3(...world), init);
  });
  await wait(0);
}

export async function hoverAt(world: P) {
  await act(async () => pointer("pointermove", new THREE.Vector3(...world)));
  await act(async () => vi.advanceTimersToNextFrame());
}

export async function clickTree(text: string) {
  const row = [...treeHost!.querySelectorAll<HTMLElement>(".tree-item")].find(
    (el) => el.textContent?.trim().endsWith(text),
  );
  expect(row, text).toBeDefined();
  await act(async () => row!.click());
  await wait(0);
}

export async function ok(host: HTMLElement) {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "OK",
  )!;
  await act(async () => button.click());
  await wait(0);
}

export const selection = () => useStore.getState().selection;
export const saved = (type: string) =>
  server.features.find((f) => f.type === type);
