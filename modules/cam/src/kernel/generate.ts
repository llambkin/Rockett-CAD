import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import {
  FINISH_PROFILE,
  type Program,
  type Section,
  type Xy,
} from "../shared/ir.js";
import { isOperation, type OperationType } from "../shared/operations.js";
import {
  adaptiveParams,
  contourParams,
  drillParams,
  laserParams,
  paramsOf,
  parallelParams,
  pocketParams,
  waterlineParams,
  type FaceRef,
} from "../shared/params.js";
import { fixturesMet, reachOf, spans } from "../post/checkSweep.js";
import { stockBox, type Box, type Placement } from "../shared/setup.js";
import type { Preset } from "../shared/tools.js";
import type { Mesh } from "../surface/dropCutter.js";
import { adaptive } from "../toolpath/adaptive.js";
import { contour } from "../toolpath/contour.js";
import { drill } from "../toolpath/drill.js";
import { facing } from "../toolpath/facing.js";
import { checkMoves, chorded } from "../toolpath/geometry.js";
import { laser } from "../toolpath/laser.js";
import { checkParallel, parallel } from "../toolpath/parallel.js";
import { pocket } from "../toolpath/pocket.js";
import { checkWaterline, waterline } from "../toolpath/waterline.js";
import { holesOf } from "./holes.js";
import adaptiveWasm from "../../wasm/adaptive/adaptive.wasm?inline";
import type { GenerateInput } from "./input.js";
import offset, { type OffsetInput } from "./offset.js";
import {
  planarFace,
  read,
  toSetup,
  type PlanarFace,
  type RegionLoop,
} from "./regions.js";
import surfaceMesh, { type SurfaceMeshInput } from "./surfaceMesh.js";

type Generator = (input: GenerateInput, scope: KernelJobScope) => Section[];

const offsetJob = offset["rockett.cam.offset"] as (
  input: OffsetInput,
  scope: KernelJobScope,
) => RegionLoop[];

const meshJob = surfaceMesh["rockett.cam.surfaceMesh"] as (
  input: SurfaceMeshInput,
  scope: KernelJobScope,
) => Mesh;

let engine: WebAssembly.Module | undefined;

export const adaptiveEngine = () =>
  (engine ??= new WebAssembly.Module(
    Uint8Array.from(
      atob(adaptiveWasm.slice(adaptiveWasm.indexOf(",") + 1)),
      (c) => c.charCodeAt(0),
    ),
  ));

const LENGTH = 1e-6;

const boxes = ({ bodies }: GenerateInput) =>
  Object.fromEntries(bodies.map(({ id, bbox }) => [id, bbox]));

function modelTop({ setup }: GenerateInput, at: Record<string, Box>) {
  const margins = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 };
  const stock = stockBox(setup, at);
  const bare = stockBox(
    { ...setup, stock: { kind: "boxAround", margins } },
    at,
  );
  return (
    bare.max[2] -
    bare.modelToSetup.translation[2] +
    stock.modelToSetup.translation[2]
  );
}

function faceOf(
  input: GenerateInput,
  scope: KernelJobScope,
  ref: FaceRef,
  downward = false,
) {
  const body = input.bodies.find(({ id }) => id === ref.bodyId);
  if (!body)
    throw new RangeError(`face body ${ref.bodyId} is not a setup body`);
  const stock = stockBox(input.setup, boxes(input));
  return {
    stock,
    face: planarFace(scope, body, ref, stock.modelToSetup, downward),
  };
}

function openingOf({ inner }: PlanarFace, ref: FaceRef, opening?: number) {
  const loop = opening === undefined ? undefined : inner[opening];
  if (!loop)
    throw new RangeError(
      `an inside contour on bottom face ${ref.faceName} of body ${ref.bodyId} must name one of its openings`,
    );
  return loop;
}

const programOf = (
  { setup, tool }: GenerateInput,
  sections: Section[],
): Program => ({
  irVersion: 1,
  units: "mm",
  setupId: setup.id,
  offsetIndex: setup.wcs.offsetIndex,
  tools: [tool],
  sections,
});

function clear(input: GenerateInput, section: Section) {
  const { fixtures = [], clearance } = input.setup;
  const swept = spans(programOf(input, [section])).flatMap(
    ({ segments }) => segments,
  );
  const [hit] = fixturesMet(swept, fixtures, clearance, reachOf(input.tool));
  const { type } = input.operation;
  if (hit)
    throw new RangeError(
      `${type.slice(type.lastIndexOf(".") + 1)} comes within the ${clearance} mm clearance of fixture ${hit.name}`,
    );
  return section;
}

function surface(
  input: GenerateInput,
  scope: KernelJobScope,
  tolerance: number,
) {
  const stock = stockBox(input.setup, boxes(input));
  const mesh = meshJob(
    {
      bodies: input.bodies.map(({ brep }) => ({ identity: brep, brep })),
      modelToSetup: stock.modelToSetup,
      tolerance,
    },
    scope,
  );
  return {
    operationId: input.operation.id,
    setup: { ...input.setup, tolerance },
    stock,
    mesh,
    tool: input.tool,
    preset: input.preset,
  };
}

const cut = ({ operation, setup, tool, preset }: GenerateInput) => ({
  operationId: operation.id,
  setup,
  tool,
  preset,
});

function pocketCut(
  input: GenerateInput,
  scope: KernelJobScope,
  floor: FaceRef,
) {
  const { stock, face } = faceOf(input, scope, floor);
  return {
    ...cut(input),
    setup: { ...input.setup, fixtures: [] },
    stock,
    bottom: face.z,
    boundary: chorded(face.outer),
    islands: face.inner.map(chorded),
  };
}

const shown = ([x, y]: Xy) => `(${x}, ${y})`;

function holesAt(
  input: GenerateInput,
  scope: KernelJobScope,
  at: Placement,
  diameter: number,
  points: Xy[] | undefined,
) {
  const sized = input.bodies
    .flatMap(({ brep }) =>
      holesOf(scope, toSetup(scope, read(scope, brep, "drill"), at)),
    )
    .filter((hole) => Math.abs(hole.diameter - diameter) <= LENGTH);
  if (!points) return sized;
  return points.map((point) => {
    const hole = sized.find(
      ({ centre }) =>
        Math.hypot(centre[0] - point[0], centre[1] - point[1]) <= LENGTH,
    );
    if (!hole)
      throw new RangeError(
        `no ${diameter} mm hole is at ${shown(point)} in the setup bodies`,
      );
    return hole;
  });
}

const GENERATORS: Readonly<Record<OperationType, Generator>> = {
  "rockett.cam.facing"(input) {
    const at = boxes(input);
    return [
      facing({
        operationId: input.operation.id,
        setup: input.setup,
        stock: stockBox(input.setup, at),
        modelTop: modelTop(input, at),
        tool: input.tool,
        preset: input.preset,
      }),
    ];
  },
  "rockett.cam.contour"(input, scope) {
    const { type, params } = input.operation;
    const {
      face: ref,
      side,
      bottomOffset,
      opening,
    } = paramsOf(contourParams, type, params);
    const { stock, face } = faceOf(input, scope, ref, true);
    const loop =
      face.down && side === "inside"
        ? openingOf(face, ref, opening)
        : face.outer;
    return [
      clear(
        input,
        contour(
          {
            ...cut(input),
            stock,
            bottom: face.z - bottomOffset,
            loop,
            side,
            direction: "climb",
            start: loop.start,
          },
          (each) => offsetJob(each, scope),
        ),
      ),
    ];
  },
  "rockett.cam.pocket"(input, scope) {
    const { type, params } = input.operation;
    const { floor, rampAngle } = paramsOf(pocketParams, type, params);
    return [pocket({ ...pocketCut(input, scope, floor), rampAngle })];
  },
  "rockett.cam.adaptive"(input, scope) {
    const { type, params } = input.operation;
    const { floor, ...rest } = paramsOf(adaptiveParams, type, params);
    return [
      clear(
        input,
        adaptive({
          ...pocketCut(input, scope, floor),
          ...rest,
          engine: adaptiveEngine(),
        }),
      ),
    ];
  },
  "rockett.cam.drill"(input, scope) {
    const { type, params } = input.operation;
    const { diameter, points } = paramsOf(drillParams, type, params);
    const stock = stockBox(input.setup, boxes(input));
    const holes = holesAt(input, scope, stock.modelToSetup, diameter, points);
    if (!holes.length)
      throw new RangeError(`no ${diameter} mm hole is in the setup bodies`);
    const { tool, preset } = input;
    const { sections, refused } = drill({
      operationId: input.operation.id,
      setup: input.setup,
      stock,
      holes,
      drills: [{ tool, preset }],
    });
    const [first] = refused;
    if (first)
      throw new RangeError(
        first.reason === "blocked"
          ? `material stands in the drill column at ${first.points.map(shown).join(", ")}`
          : `${tool.name} is not a drill within 0.01 mm of ${diameter} mm`,
      );
    return sections.map((section) => clear(input, section));
  },
  "rockett.cam.parallel"(input, scope) {
    const { type, params } = input.operation;
    const { angle, tolerance } = paramsOf(parallelParams, type, params);
    checkParallel({ ...input, setup: { ...input.setup, tolerance }, angle });
    const at = surface(input, scope, tolerance);
    const [min, max] = [at.stock.min, at.stock.max];
    return [
      parallel({
        ...at,
        angle,
        boundary: [
          [
            { x: min[0], y: min[1] },
            { x: max[0], y: min[1] },
            { x: max[0], y: max[1] },
            { x: min[0], y: max[1] },
          ],
        ],
      }),
    ];
  },
  "rockett.cam.waterline"(input, scope) {
    const { type, params } = input.operation;
    const { angle, tolerance } = paramsOf(waterlineParams, type, params);
    checkWaterline({ ...input, setup: { ...input.setup, tolerance }, angle });
    return [waterline({ ...surface(input, scope, tolerance), angle })];
  },
  "rockett.cam.laser"(input, scope) {
    const { type, params } = input.operation;
    const { face: ref, ...beam } = paramsOf(laserParams, type, params);
    const { stock, face } = faceOf(input, scope, ref);
    return [
      laser({
        ...cut(input),
        ...beam,
        stock,
        profiles: [face.outer, ...face.inner],
      }),
    ];
  },
};

function profiled(sections: Section[], { profile }: Preset): Section[] {
  if (profile === undefined || profile === FINISH_PROFILE) return sections;
  return sections.map((section) =>
    section.pass === "finish" ? { ...section, profile } : section,
  );
}

function generate(input: GenerateInput, scope: KernelJobScope): Program {
  const { type } = input.operation;
  if (!isOperation(type)) throw new Error(`operation ${type} is unknown`);
  scope.progress(0, 1, type);
  const sections = profiled(GENERATORS[type](input, scope), input.preset);
  checkMoves(
    `operation ${input.operation.id}`,
    sections.reduce((sum, { moves }) => sum + moves.length, 0),
  );
  scope.progress(1, 1, type);
  return programOf(input, sections);
}

export default defineKernelJobs({ "rockett.cam.generate": generate });
