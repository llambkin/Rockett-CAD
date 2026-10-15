import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  solveSketch,
  trimPiece,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchPoint,
} from "@rockett/shared";
import { useStore } from "../src/store";
import { api } from "../src/api";
import { sketchToolFor, withKey } from "../src/shortcuts";
import { renderSketches } from "../src/three/sketchRender";
import { themeColor } from "../src/theme/tokens";
import type { CadViewport } from "../src/three/CadViewport";
vi.mock("../src/api", () => ({
  api: { updateFeature: vi.fn() },
}));

const S = 40;
const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (
  id: string,
  p1: string,
  p2: string,
  construction?: boolean,
): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
  ...(construction && { construction }),
});

const inscribed = (): SketchEntity[] => [
  P("a", 0, 0),
  P("b", S, 0),
  P("c", S, S),
  P("d", 0, S),
  L("l1", "a", "b"),
  L("l2", "b", "c"),
  L("l3", "c", "d"),
  L("l4", "d", "a"),
  P("o", S / 2, S / 2),
  { id: "ci", kind: "circle", center: "o", radius: S / 2 },
];
const inscribedConstraints: SketchConstraint[] = [
  { id: "h1", type: "horizontal", line: "l1" },
  { id: "v2", type: "vertical", line: "l2" },
  { id: "h3", type: "horizontal", line: "l3" },
  { id: "v4", type: "vertical", line: "l4" },
  { id: "fix", type: "fix", point: "a" },
  { id: "w", type: "length", line: "l3", value: S },
  { id: "h", type: "length", line: "l4", value: S },
  { id: "r", type: "radius", entity: "ci", value: S / 2 },
  { id: "t1", type: "tangent", a: "l1", b: "ci" },
  { id: "t2", type: "tangent", a: "l2", b: "ci" },
  { id: "t3", type: "tangent", a: "l3", b: "ci" },
  { id: "t4", type: "tangent", a: "l4", b: "ci" },
];

const crossing = (): SketchEntity[] => [
  P("xa", 0, 0),
  P("xb", 10, 10),
  P("ya", 0, 10),
  P("yb", 10, 0),
  L("x", "xa", "xb"),
  L("y", "ya", "yb"),
];

const sketch = (
  entities: SketchEntity[],
  constraints: SketchConstraint[] = [],
): SketchFeature => ({
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities,
  constraints,
});

function open(entities: SketchEntity[], constraints: SketchConstraint[] = []) {
  const doc = createEmptyDocument("trim", "Trim");
  doc.features = [sketch(entities, constraints)];
  doc.timelinePosition = 1;
  useStore.setState({
    document: doc,
    projectId: doc.id,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    mode: {
      name: "sketch",
      sketchId: "sk",
      tool: "trim",
      constructionMode: false,
    },
    draftSketch: sketch(entities, constraints),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.updateFeature).mockImplementation(async (_id, _fid, patch) => {
    const doc = useStore.getState().document!;
    const next = {
      ...doc,
      features: [{ ...(doc.features[0] as SketchFeature), ...patch }],
    } as typeof doc;
    return {
      document: next,
      evaluation: {
        bodies: [],
        planes: [],
        kernelMs: 0,
        featureStatuses: [],
        sketches: [],
      },
    } as any;
  });
});

const draft = () => useStore.getState().draftSketch!;
const point = (id: string) =>
  draft().entities.find(
    (e): e is SketchPoint => e.id === id && e.kind === "point",
  )!;
const entity = (id: string) => draft().entities.find((e) => e.id === id);
const at = (angle: number, r = S / 2) => ({
  x: S / 2 + r * Math.cos((angle * Math.PI) / 180),
  y: S / 2 + r * Math.sin((angle * Math.PI) / 180),
});
const xy = (id: string) => [point(id).x, point(id).y];
const close = (a: number[], b: number[]) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

async function trim(id: string, click: { x: number; y: number }) {
  const before = useStore.getState().undoStack.length;
  await useStore.getState().trimSketchCurve(id, click);
  expect(useStore.getState().undoStack).toHaveLength(before + 1);
  const d = draft();
  expect(
    solveSketch({ entities: d.entities, constraints: d.constraints }).converged,
  ).toBe(true);
}

describe("sketch trim", () => {
  it("hovers the piece between the nearest intersections", () => {
    const piece = trimPiece(inscribed(), "ci", at(45, S / 2 + 0.3));
    expect(piece.entityId).toBe("ci");
    close(piece.samples.slice(0, 2), [S, S / 2]);
    close(piece.samples.slice(-2), [S / 2, S]);
    const side = trimPiece(inscribed(), "l1", { x: 10, y: 0.2 });
    expect(side.samples).toHaveLength(4);
    close(side.samples, [0, 0, S / 2, 0]);
  });

  it("draws only the hovered piece in the hover colour", () => {
    const root = new THREE.Group();
    const viewport = {
      getSketchRoot: () => root,
      requestRender: () => {},
    } as unknown as CadViewport;
    const piece = trimPiece(inscribed(), "ci", at(45)).samples;
    renderSketches(
      viewport,
      [
        {
          sketchId: "sk",
          frame: {
            origin: [0, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
          },
          entities: inscribed(),
          showProfiles: false,
          active: true,
        },
      ],
      [],
      { kind: "sketchEntity", sketchId: "sk", entityId: "ci", piece },
    );
    const hover = new THREE.Color(themeColor("hover")).getHex();
    const lit = root.children[0]!.children.filter(
      (o): o is THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> =>
        o instanceof THREE.Line && o.material.color.getHex() === hover,
    );
    expect(lit).toHaveLength(1);
    expect(lit[0]!.geometry.getAttribute("position").count).toBe(
      piece.length / 2,
    );
    expect(lit[0]!.userData.sketchEntityId).toBeUndefined();
  });

  it("selects Trim with T", () => {
    expect(sketchToolFor("t")).toBe("trim");
    expect(withKey("Trim", "trim")).toBe("Trim (T)");
  });

  it("turns the inscribed circle into a three-quarter arc on its cutters", async () => {
    open(inscribed(), inscribedConstraints);
    await trim("ci", at(45));
    const arc = entity("ci")!;
    expect(arc.kind).toBe("arc");
    if (arc.kind !== "arc") return;
    close(xy(arc.start), [S / 2, S]);
    close(xy(arc.end), [S, S / 2]);
    expect(arc.center).toBe("o");
    const on = draft().constraints.filter(
      (c) => c.type === "pointOnLine" || c.type === "coincident",
    );
    expect(
      on.map((c) =>
        c.type === "pointOnLine" ? [c.point, c.line] : [c.a, c.b],
      ),
    ).toEqual(
      expect.arrayContaining([
        [arc.start, "l3"],
        [arc.end, "l2"],
      ]),
    );
    expect(draft().constraints.map((c) => c.id)).toEqual(
      expect.arrayContaining(["r", "t1", "t2", "t3", "t4"]),
    );
  });

  it("trims one half of a square side and keeps the other half", async () => {
    open(inscribed(), inscribedConstraints);
    await trim("l1", { x: 10, y: 0 });
    const side = entity("l1")!;
    expect(side.kind).toBe("line");
    if (side.kind !== "line") return;
    close(xy(side.p1), [S / 2, 0]);
    expect(side.p2).toBe("b");
    expect(entity("a")).toBeDefined();
    expect(draft().constraints).toContainEqual(
      expect.objectContaining({
        type: "pointOnCircle",
        point: side.p1,
        circle: "ci",
      }),
    );
    expect(draft().constraints.map((c) => c.id)).toEqual(
      expect.arrayContaining(["h1", "t1", "fix"]),
    );
  });

  it("shortens a crossing line to the crossing", async () => {
    open(crossing(), [
      { id: "gap", type: "distance", a: "xa", b: "ya", axis: null, value: 10 },
    ]);
    await trim("x", { x: 2, y: 2 });
    const x = entity("x")!;
    if (x.kind !== "line") throw new Error("x is not a line");
    close(xy(x.p1), [5, 5]);
    expect(x.p2).toBe("xb");
    expect(entity("xa")).toBeUndefined();
    expect(draft().constraints.find((c) => c.id === "gap")).toBeUndefined();
    expect(draft().constraints).toContainEqual(
      expect.objectContaining({ type: "pointOnLine", point: x.p1, line: "y" }),
    );
  });

  it("splits a line crossed twice into two pieces", async () => {
    open(
      [
        P("s", 0, 0),
        P("e", 20, 0),
        L("base", "s", "e"),
        P("a1", 5, -5),
        P("a2", 5, 5),
        L("a", "a1", "a2"),
        P("b1", 15, -5),
        P("b2", 15, 5),
        L("b", "b1", "b2"),
      ],
      [
        { id: "flat", type: "horizontal", line: "base" },
        { id: "len", type: "length", line: "base", value: 20 },
      ],
    );
    await trim("base", { x: 10, y: 0 });
    const lines = draft().entities.filter(
      (e) => e.kind === "line" && !["a", "b"].includes(e.id),
    );
    expect(
      lines.map((e) => e.kind === "line" && [...xy(e.p1), ...xy(e.p2)]),
    ).toEqual([
      [0, 0, 5, 0],
      [15, 0, 20, 0],
    ]);
    const ids = draft().constraints.map((c) => c.id);
    expect(ids).toContain("flat");
    expect(ids).not.toContain("len");
  });

  it("deletes a curve with no intersections whole", async () => {
    open(
      [P("s", 0, 0), P("e", 10, 0), L("lone", "s", "e")],
      [{ id: "flat", type: "horizontal", line: "lone" }],
    );
    await trim("lone", { x: 5, y: 0 });
    expect(draft().entities).toEqual([]);
    expect(draft().constraints).toEqual([]);
  });

  it("never cuts with construction curves, but trims them", async () => {
    const entities = crossing().map((e) =>
      e.id === "y" ? { ...e, construction: true } : e,
    );
    open(entities);
    await trim("x", { x: 2, y: 2 });
    expect(entity("x")).toBeUndefined();
    open(entities);
    await trim("y", { x: 2, y: 8 });
    const y = entity("y")!;
    if (y.kind !== "line") throw new Error("y is not a line");
    expect(y.construction).toBe(true);
    close(xy(y.p1), [5, 5]);
  });

  it("finds the hovered piece of a 200-curve sketch in well under 1 ms", () => {
    const entities: SketchEntity[] = [];
    for (let i = 0; i < 100; i++) {
      const x = (i % 10) * 30;
      const y = Math.floor(i / 10) * 30;
      entities.push(
        P(`o${i}`, x, y),
        { id: `c${i}`, kind: "circle", center: `o${i}`, radius: 20 },
        P(`s${i}`, x - 25, y + 5),
        P(`e${i}`, x + 25, y + 5),
        L(`l${i}`, `s${i}`, `e${i}`),
      );
    }
    const t0 = performance.now();
    trimPiece(entities, "l0", { x: 0, y: 5 });
    const first = performance.now() - t0;
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const id = i % 2 ? `c${i % 100}` : `l${i % 100}`;
      const s = performance.now();
      trimPiece(entities, id, { x: (i % 10) * 30, y: Math.floor(i / 10) * 3 });
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    console.log(
      `200-curve trim hover: first ${first.toFixed(1)} ms, then median ${(times[100]! * 1000).toFixed(0)} us, p95 ${(times[190]! * 1000).toFixed(0)} us`,
    );
    expect(times[100]!).toBeLessThan(1);
  });
});
