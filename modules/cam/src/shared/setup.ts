import type { Xyz } from "./ir.js";

export type Placement = {
  rotation: [number, number, number, number];
  translation: Xyz;
};

export type Box = { min: Xyz; max: Xyz };

export type Axis = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export type Stock =
  | {
      kind: "boxAround";
      margins: {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
        zMin: number;
        zMax: number;
      };
    }
  | { kind: "box"; size: Xyz }
  | { kind: "cylinder"; diameter: number; height: number };

export type VertexRef = { kind: "vertex"; bodyId: string; vertexName: string };

type Side = "min" | "max";

export type Wcs = {
  origin:
    | { kind: "stockCorner"; x: Side; y: Side; z: Side }
    | { kind: "reference"; ref: VertexRef; offset: Xyz };
  axes: { x: Axis; z: Axis };
  offsetIndex: number;
  machine: { kind: "unknown" } | { kind: "known"; origin: Xyz };
};

export type Fixture = { name: string; min: Xyz; max: Xyz };

export type Setup = {
  id: string;
  name: string;
  bodies: string[];
  stock: Stock;
  wcs: Wcs;
  safeHeight: number;
  clearance: number;
  tolerance: number;
  fixtures: Fixture[];
};

export type Travel =
  | { status: "unverified" }
  | { status: "within" }
  | { status: "outside"; axes: ("x" | "y" | "z")[] };

type Matrix = [Xyz, Xyz, Xyz];

const XYZ = [0, 1, 2] as const;

function unit(axis: Axis): Xyz {
  const v: Xyz = [0, 0, 0];
  v["xyz".indexOf(axis[1]!)] = axis[0] === "+" ? 1 : -1;
  return v;
}

function rows({ x, z }: Wcs["axes"]): Matrix {
  if (x[1] === z[1])
    throw new Error("setup X and Z axes must be perpendicular");
  const [X, Z] = [unit(x), unit(z)];
  const Y: Xyz = [
    Z[1] * X[2] - Z[2] * X[1],
    Z[2] * X[0] - Z[0] * X[2],
    Z[0] * X[1] - Z[1] * X[0],
  ];
  return [X, Y, Z];
}

function quaternion([[a, b, c], [d, e, f], [g, h, i]]: Matrix) {
  const trace = a + e + i;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    return [(h - f) / s, (c - g) / s, (d - b) / s, s / 4] as const;
  }
  if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i);
    return [s / 4, (b + d) / s, (c + g) / s, (h - f) / s] as const;
  }
  if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i);
    return [(b + d) / s, s / 4, (f + h) / s, (c - g) / s] as const;
  }
  const s = 2 * Math.sqrt(1 + i - a - e);
  return [(c + g) / s, (f + h) / s, s / 4, (d - b) / s] as const;
}

function dot(a: Xyz, b: Xyz): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function apply([x, y, z]: Matrix, p: Xyz): Xyz {
  return [dot(x, p), dot(y, p), dot(z, p)];
}

function bodiesBox(setup: Setup, matrix: Matrix, boxes: Record<string, Box>) {
  if (!setup.bodies.length) throw new Error("setup has no bodies");
  const min: Xyz = [Infinity, Infinity, Infinity];
  const max: Xyz = [-Infinity, -Infinity, -Infinity];
  for (const id of setup.bodies) {
    const box = boxes[id];
    if (!box) throw new Error(`setup body ${id} has no box`);
    const a = apply(matrix, box.min);
    const b = apply(matrix, box.max);
    for (const i of XYZ) {
      min[i] = Math.min(min[i], a[i], b[i]);
      max[i] = Math.max(max[i], a[i], b[i]);
    }
  }
  return { min, max };
}

function stockAround(stock: Stock, bodies: Box): Box {
  if (stock.kind === "boxAround") {
    const m = stock.margins;
    return {
      min: [
        bodies.min[0] - m.xMin,
        bodies.min[1] - m.yMin,
        bodies.min[2] - m.zMin,
      ],
      max: [
        bodies.max[0] + m.xMax,
        bodies.max[1] + m.yMax,
        bodies.max[2] + m.zMax,
      ],
    };
  }
  const [length, width, height] =
    stock.kind === "box"
      ? stock.size
      : [stock.diameter, stock.diameter, stock.height];
  const cx = (bodies.min[0] + bodies.max[0]) / 2;
  const cy = (bodies.min[1] + bodies.max[1]) / 2;
  const floor = bodies.min[2];
  return {
    min: [cx - length / 2, cy - width / 2, floor],
    max: [cx + length / 2, cy + width / 2, floor + height],
  };
}

export function stockBox(
  setup: Setup,
  bodyBoxes: Record<string, Box>,
  referencePoint?: Xyz,
): Box & { modelToSetup: Placement } {
  const matrix = rows(setup.wcs.axes);
  const stock = stockAround(setup.stock, bodiesBox(setup, matrix, bodyBoxes));
  const { origin } = setup.wcs;
  let at: Xyz;
  if (origin.kind === "stockCorner") {
    at = [stock[origin.x][0], stock[origin.y][1], stock[origin.z][2]];
  } else {
    if (!referencePoint)
      throw new Error("the WCS reference needs its resolved point");
    const p = apply(matrix, referencePoint);
    at = [
      p[0] + origin.offset[0],
      p[1] + origin.offset[1],
      p[2] + origin.offset[2],
    ];
  }
  const shift = (p: Xyz): Xyz => [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  return {
    min: shift(stock.min),
    max: shift(stock.max),
    modelToSetup: {
      rotation: [...quaternion(matrix)],
      translation: shift([0, 0, 0]),
    },
  };
}

export function checkTravel(wcs: Wcs, box: Box, travel: Box): Travel {
  if (wcs.machine.kind === "unknown") return { status: "unverified" };
  const { origin } = wcs.machine;
  const axes = (["x", "y", "z"] as const).filter(
    (_, i) =>
      box.min[i]! + origin[i]! < travel.min[i]! ||
      box.max[i]! + origin[i]! > travel.max[i]!,
  );
  return axes.length ? { status: "outside", axes } : { status: "within" };
}
