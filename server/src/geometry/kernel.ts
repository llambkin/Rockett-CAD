/**
 * OCCT (OpenCascade) WASM kernel bootstrap and low-level helpers.
 *
 * The kernel is loaded once per process. All geometry code receives the
 * kernel instance via `getKernel()` after `initKernel()` resolves.
 */

import type { Health, Placement } from "@rockett/shared";

// The opencascade.js typings are enormous; we treat the instance as `any`
// and keep all raw-kernel access inside server/src/geometry.
export type OC = any;
export type Shape = any; // TopoDS_Shape

let oc: OC | null = null;
let range: any = null;
let cancel: { indicator: any; ranges: any[] } | null = null;
let initPromise: Promise<OC> | null = null;

export async function initKernel(): Promise<OC> {
  if (oc) return oc;
  if (!initPromise) {
    initPromise = (async () => {
      const { default: initOpenCascade } = await import(
        // @ts-ignore — dist/node.js has no type declarations
        "opencascade.js/dist/node.js"
      );
      const kernel = await initOpenCascade();
      range = new kernel.Message_ProgressRange_1();
      oc = kernel;
      return kernel;
    })();
  }
  return initPromise;
}

export function kernelVersion(): Health["kernelVersion"] {
  return oc?.versionId() ?? null;
}

export function getKernel(): OC {
  if (!oc)
    throw new Error("OCCT kernel not initialised: call initKernel() first");
  return oc;
}

// ---------------------------------------------------------------------------
// Iteration / conversion helpers
// ---------------------------------------------------------------------------

const HASH_BOUND = 1_000_000_007;

/** Stable-ish identity hash for a TopoDS_Shape (TShape pointer + location). */
export function shapeHash(shape: Shape): number {
  return getKernel().shapeHash(shape, HASH_BOUND);
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
  const map = new k.TopTools_IndexedMapOfShape_1();
  try {
    k.TopExp.MapShapes_1(shape, enumMap[type], map);
    for (let i = 1; i <= map.Extent(); i++) yield map.FindKey_2(i);
  } finally {
    map.delete();
  }
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

function downcast(
  shape: Shape,
  type: "face" | "edge" | "vertex" | "solid" | "wire",
) {
  const k = getKernel();
  const cast = {
    face: k.TopoDS.Face_1,
    edge: k.TopoDS.Edge_1,
    vertex: k.TopoDS.Vertex_1,
    solid: k.TopoDS.Solid_1,
    wire: k.TopoDS.Wire_1,
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

export function wires(shape: Shape): Shape[] {
  return downcast(shape, "wire");
}

export function shapeList(shapes: Iterable<Shape>): any {
  const list = new (getKernel().TopTools_ListOfShape_1)();
  for (const shape of shapes) list.Append_1(shape).delete();
  return list;
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
  return new k.gp_Dir_5(x, y, z);
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

export function transformOp(shape: Shape, trsf: any): any {
  return new (getKernel().BRepBuilderAPI_Transform_2)(shape, trsf, true, false);
}

export function progress(): any {
  getKernel();
  if (!cancel) return range;
  const started = cancel.indicator.Start();
  cancel.ranges.push(started);
  return started;
}

export function cancellable<T>(
  isCancelled: (() => boolean) | undefined,
  fn: () => T,
): T {
  if (!isCancelled) return fn();
  const outer = cancel;
  const scope = {
    indicator: new (getKernel().CancelIndicator)(isCancelled),
    ranges: [],
  };
  cancel = scope;
  try {
    return fn();
  } finally {
    cancel = outer;
    release(scope.ranges);
    scope.indicator.delete();
  }
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

export function volumeAbout(
  shape: Shape,
  at: [number, number, number],
): number {
  const k = getKernel();
  return scoped((own) => {
    const props = own(new k.GProp_GProps_1());
    const plane = own(new k.gp_Pln_3(own(pnt(...at)), own(dir(0, 0, 1))));
    k.BRepGProp.VolumePropertiesGK_2(
      shape,
      props,
      plane,
      1e-6,
      false,
      true,
      false,
      false,
      false,
    );
    return props.Mass();
  });
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
    if (err instanceof WebAssembly.Exception) {
      const k = getKernel();
      const [, message] = k.getExceptionMessage(err);
      k.decrementExceptionRefcount(err);
      throw new Error(`${label}: ${message}`, { cause: err });
    }
    throw new Error(`${label}: ${err?.message ?? String(err)}`, {
      cause: err,
    });
  }
}
