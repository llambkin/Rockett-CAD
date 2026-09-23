/**
 * OCCT (OpenCascade) WASM kernel bootstrap and low-level helpers.
 *
 * The kernel is loaded once per process. All geometry code receives the
 * kernel instance via `getKernel()` after `initKernel()` resolves.
 */

import type { Placement } from "@rockett/shared";

// The opencascade.js typings are enormous; we treat the instance as `any`
// and keep all raw-kernel access inside server/src/geometry.
export type OC = any;
export type Shape = any; // TopoDS_Shape

let oc: OC | null = null;
let initPromise: Promise<OC> | null = null;

export async function initKernel(): Promise<OC> {
  if (oc) return oc;
  if (!initPromise) {
    initPromise = (async () => {
      const { default: initOpenCascade } = await import(
        // @ts-ignore — dist/node.js has no type declarations
        "opencascade.js/dist/node.js"
      );
      oc = await initOpenCascade();
      return oc;
    })();
  }
  return initPromise;
}

export function getKernel(): OC {
  if (!oc)
    throw new Error("OCCT kernel not initialised — call initKernel() first");
  return oc;
}

// ---------------------------------------------------------------------------
// Iteration / conversion helpers
// ---------------------------------------------------------------------------

const HASH_BOUND = 1_000_000_007;

/** Stable-ish identity hash for a TopoDS_Shape (TShape pointer + location). */
export function shapeHash(shape: Shape): number {
  return shape.HashCode(HASH_BOUND);
}

export function* explore(
  shape: Shape,
  type: "face" | "edge" | "vertex" | "solid" | "wire" | "shell",
): Generator<Shape> {
  const k = getKernel();
  const enumMap: Record<string, any> = {
    face: k.TopAbs_ShapeEnum.TopAbs_FACE,
    edge: k.TopAbs_ShapeEnum.TopAbs_EDGE,
    vertex: k.TopAbs_ShapeEnum.TopAbs_VERTEX,
    solid: k.TopAbs_ShapeEnum.TopAbs_SOLID,
    wire: k.TopAbs_ShapeEnum.TopAbs_WIRE,
    shell: k.TopAbs_ShapeEnum.TopAbs_SHELL,
  };
  const ex = new k.TopExp_Explorer_2(
    shape,
    enumMap[type],
    k.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  // De-duplicate: an explorer visits shared subshapes once per occurrence.
  const seen = new Set<number>();
  while (ex.More()) {
    const s = ex.Current();
    const h = shapeHash(s);
    if (!seen.has(h)) {
      seen.add(h);
      yield s;
    } else s.delete();
    ex.Next();
  }
  ex.delete();
}

type Owned = { delete(): void };

export function release(handles: Iterable<Owned>): void {
  for (const handle of handles) handle.delete();
}

export function scoped<T>(
  fn: (own: <H extends Owned>(handle: H) => H) => T,
): T {
  const owned: Owned[] = [];
  try {
    return fn((handle) => {
      owned.push(handle);
      return handle;
    });
  } finally {
    release(owned);
  }
}

function downcast(shape: Shape, type: "face" | "edge" | "vertex" | "solid") {
  const k = getKernel();
  const cast = {
    face: k.TopoDS.Face_1,
    edge: k.TopoDS.Edge_1,
    vertex: k.TopoDS.Vertex_1,
    solid: k.TopoDS.Solid_1,
  }[type];
  return [...explore(shape, type)].map((s) => {
    const typed = cast(s);
    s.delete();
    return typed;
  });
}

export function faces(shape: Shape): Shape[] {
  return downcast(shape, "face");
}

export function edges(shape: Shape): Shape[] {
  return downcast(shape, "edge");
}

export function vertices(shape: Shape): Shape[] {
  return downcast(shape, "vertex");
}

export function solids(shape: Shape): Shape[] {
  return downcast(shape, "solid");
}

/** Convert a TopTools_ListOfShape to a JS array and delete the list. */
export function listToArray(list: any): Shape[] {
  const out: Shape[] = [];
  if (!list) return out;
  while (list.Size() > 0) {
    out.push(list.First_1());
    list.RemoveFirst();
  }
  list.delete();
  return out;
}

export function pnt(x: number, y: number, z: number): any {
  const k = getKernel();
  return new k.gp_Pnt_3(x, y, z);
}

export function dir(x: number, y: number, z: number): any {
  const k = getKernel();
  return new k.gp_Dir_4(x, y, z);
}

export function vec(x: number, y: number, z: number): any {
  const k = getKernel();
  return new k.gp_Vec_4(x, y, z);
}

export function placementToTrsf(placement: Placement): any {
  const k = getKernel();
  const rotation = new k.gp_Quaternion_2(...placement.rotation);
  const translation = vec(...placement.translation);
  const trsf = new k.gp_Trsf_1();
  trsf.SetRotation_2(rotation);
  trsf.SetTranslationPart(translation);
  rotation.delete();
  translation.delete();
  return trsf;
}

export function progress(): any {
  const k = getKernel();
  return new k.Message_ProgressRange_1();
}

/** Volume of a solid shape in mm³. */
export function volumeOf(shape: Shape): number {
  const k = getKernel();
  const props = new k.GProp_GProps_1();
  k.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  const v = props.Mass();
  props.delete();
  return v;
}

/** Surface area in mm². */
export function areaOf(shape: Shape): number {
  const k = getKernel();
  const props = new k.GProp_GProps_1();
  k.BRepGProp.SurfaceProperties_1(shape, props, false, false);
  const a = props.Mass();
  props.delete();
  return a;
}

/** Length of an edge/wire in mm. */
export function lengthOf(shape: Shape): number {
  const k = getKernel();
  const props = new k.GProp_GProps_1();
  k.BRepGProp.LinearProperties(shape, props, false, false);
  const l = props.Mass();
  props.delete();
  return l;
}

export function bboxOf(shape: Shape): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const k = getKernel();
  const box = new k.Bnd_Box_1();
  k.BRepBndLib.Add(shape, box, false);
  const cmin = box.CornerMin();
  const cmax = box.CornerMax();
  const result = {
    min: [cmin.X(), cmin.Y(), cmin.Z()] as [number, number, number],
    max: [cmax.X(), cmax.Y(), cmax.Z()] as [number, number, number],
  };
  cmin.delete();
  cmax.delete();
  box.delete();
  return result;
}

/** Centroid of a face (surface center of mass). */
export function faceCentroid(face: Shape): [number, number, number] {
  const k = getKernel();
  const props = new k.GProp_GProps_1();
  k.BRepGProp.SurfaceProperties_1(face, props, false, false);
  const c = props.CentreOfMass();
  const out: [number, number, number] = [c.X(), c.Y(), c.Z()];
  c.delete();
  props.delete();
  return out;
}

export function planarFacePlane(face: Shape): {
  origin: [number, number, number];
  normal: [number, number, number];
} | null {
  const k = getKernel();
  const surf = new k.BRepAdaptor_Surface_2(face, false);
  if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Plane) {
    surf.delete();
    return null;
  }
  const pln = surf.Plane();
  const axis = pln.Axis();
  const d = axis.Direction();
  const loc = pln.Location();
  const sgn =
    face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
  const out = {
    origin: [loc.X(), loc.Y(), loc.Z()] as [number, number, number],
    normal: [sgn * d.X(), sgn * d.Y(), sgn * d.Z()] as [number, number, number],
  };
  loc.delete();
  d.delete();
  axis.delete();
  pln.delete();
  surf.delete();
  return out;
}

export function edgeCentroid(edge: Shape): [number, number, number] {
  const k = getKernel();
  const props = new k.GProp_GProps_1();
  k.BRepGProp.LinearProperties(edge, props, false, false);
  const c = props.CentreOfMass();
  const out: [number, number, number] = [c.X(), c.Y(), c.Z()];
  c.delete();
  props.delete();
  return out;
}

/** Wrap an OCCT call, translating kernel aborts into JS errors. */
export function kernelCall<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (err: any) {
    if (typeof err === "number") {
      // Emscripten C++ exception pointer — try to extract a message.
      let msg = `OCCT exception #${err}`;
      try {
        const k = getKernel();
        if (k.OCJS?.getStandard_FailureData) {
          const failure = k.OCJS.getStandard_FailureData(err);
          if (failure?.GetMessageString) msg = failure.GetMessageString();
        }
      } catch {
        // keep generic message
      }
      throw new Error(`${label}: ${msg}`);
    }
    throw new Error(`${label}: ${err?.message ?? String(err)}`);
  }
}
