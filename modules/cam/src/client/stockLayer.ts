import * as THREE from "three";
import {
  themed,
  type Layer,
  type OpenProject,
  type ProjectView,
} from "@rockett/plugin-api";
import {
  stockBox,
  type Box,
  type Fixture,
  type Placement,
  type StockSetup,
} from "../shared/setup.js";
import type { HoldDownDraft } from "./holdDowns.js";
import { bodyBoxes, camRead } from "./setup.js";
import type { Simulation, ToolpathPreview } from "./toolpaths.js";

export const STOCK_LAYER = "rockett.cam.stock";

const STOCK_TOKEN = "border";
const GOUGE_TOKEN = "err";
const HOLD_DOWN_TOKEN = "warn";
const AXIS_TOKENS = ["axis-x", "axis-y", "axis-z"] as const;
const TRIAD_FRACTION = 0.25;

const line = (points: THREE.Vector3[], token: string) =>
  new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    themed(new THREE.LineBasicMaterial(), token),
  );

export function placeInModel<O extends THREE.Object3D>(
  object: O,
  { translation, rotation }: Placement,
): O {
  new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...translation),
      new THREE.Quaternion(...rotation),
      new THREE.Vector3(1, 1, 1),
    )
    .invert()
    .decompose(object.position, object.quaternion, object.scale);
  return object;
}

function boxLines({ min, max }: Box, token: string) {
  const [a, b] = [new THREE.Vector3(...min), new THREE.Vector3(...max)];
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? b.x : a.x,
        i & 2 ? b.y : a.y,
        i & 4 ? b.z : a.z,
      ),
  );
  const edges = corners.flatMap((corner, i) =>
    [1, 2, 4]
      .filter((bit) => !(i & bit))
      .flatMap((bit) => [corner, corners[i | bit]!]),
  );
  return line(edges, token);
}

const holdDowns = (fixtures: Fixture[]) =>
  fixtures.map((fixture) => boxLines(fixture, HOLD_DOWN_TOKEN));

function stockObject(
  setup: StockSetup,
  fixtures: Fixture[],
  open: OpenProject,
) {
  const { min, max, modelToSetup } = stockBox(setup, bodyBoxes(open));
  const [a, b] = [new THREE.Vector3(...min), new THREE.Vector3(...max)];
  const object = new THREE.Group();
  object.add(boxLines({ min, max }, STOCK_TOKEN), ...holdDowns(fixtures));
  const reach = TRIAD_FRACTION * Math.max(...b.clone().sub(a).toArray());
  AXIS_TOKENS.forEach((token, i) =>
    object.add(
      line(
        [new THREE.Vector3(), new THREE.Vector3().setComponent(i, reach)],
        token,
      ),
    ),
  );
  return placeInModel(object, modelToSetup);
}

function drawn(open: OpenProject, draft: HoldDownDraft) {
  const read = camRead(open);
  const present = new Set(open.bodies.map(({ id }) => id));
  const setups = read.status === "kept" ? [] : read.data.setups;
  const saved = setups.flatMap(({ bodies, stock, wcs, fixtures = [] }) =>
    bodies?.length && bodies.every((id) => present.has(id)) && stock && wcs
      ? [stockObject({ bodies, stock, wcs }, fixtures, open)]
      : [],
  );
  const live = draft.get();
  if (!live?.fixtures.length || !live.setup.bodies.length) return saved;
  const { modelToSetup } = stockBox(live.setup, bodyBoxes(open));
  const object = new THREE.Group().add(...holdDowns(live.fixtures));
  return [...saved, placeInModel(object, modelToSetup)];
}

function mesh(
  positions: THREE.BufferAttribute,
  index: Uint32Array,
  token: string,
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, themed(material, token));
}

function surfaceObject({
  map: { min, cellMm, columns, rows, heights },
  modelToSetup,
  check,
}: Extract<Simulation, { status: "done" }>) {
  const positions = new Float32Array(heights.length * 3);
  heights.forEach((z, c) => {
    positions[3 * c] = min[0] + ((c % columns) + 0.5) * cellMm;
    positions[3 * c + 1] = min[1] + (Math.floor(c / columns) + 0.5) * cellMm;
    positions[3 * c + 2] = z;
  });
  const gouged = "gouged" in check ? check.gouged : undefined;
  const quads = Math.max(0, columns - 1) * Math.max(0, rows - 1) * 6;
  const plain = new Uint32Array(quads);
  const red = new Uint32Array(quads);
  let [p, r] = [0, 0];
  for (let j = 0; j + 1 < rows; j++)
    for (let i = 0; i + 1 < columns; i++) {
      const a = j * columns + i;
      const b = a + columns;
      const quad = [a, a + 1, b + 1, a, b + 1, b];
      if (gouged && quad.some((c) => gouged[c])) {
        red.set(quad, r);
        r += 6;
      } else {
        plain.set(quad, p);
        p += 6;
      }
    }
  const shared = new THREE.BufferAttribute(positions, 3);
  const object = new THREE.Group();
  object.add(mesh(shared, plain.subarray(0, p), STOCK_TOKEN));
  if (r) object.add(mesh(shared, red.subarray(0, r), GOUGE_TOKEN));
  return placeInModel(object, modelToSetup);
}

export const stockLayer = (
  project: ProjectView,
  preview: ToolpathPreview,
  draft: HoldDownDraft,
): Layer => ({
  id: STOCK_LAYER,
  mount({ group, requestRender, clearGroup }) {
    const boxes = new THREE.Group();
    const surface = new THREE.Group();
    group.add(boxes, surface);
    let shown: Simulation | undefined;
    const drawBoxes = () => {
      clearGroup(boxes);
      try {
        for (const object of drawn(project.get(), draft)) boxes.add(object);
      } catch (error) {
        console.error(`[rockett] ${STOCK_LAYER}: ${String(error)}`);
      }
      requestRender();
    };
    const drawSurface = () => {
      const { simulation } = preview.get();
      if (simulation === shown) return;
      shown = simulation;
      clearGroup(surface);
      if (simulation.status === "done") surface.add(surfaceObject(simulation));
      requestRender();
    };
    drawBoxes();
    drawSurface();
    const stops = [
      project.subscribe(drawBoxes),
      draft.subscribe(drawBoxes),
      preview.subscribe(drawSurface),
    ];
    return () => stops.forEach((stop) => stop());
  },
});
