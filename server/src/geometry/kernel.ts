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
let cancel: {
  indicator: any;
  owner: HandleScope;
  isCancelled: () => boolean;
} | null = null;
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
  const scope = new HandleScope();
  const map = scope.acquire(new k.TopTools_IndexedMapOfShape_1());
  try {
    k.TopExp.MapShapes_1(shape, enumMap[type], map);
    for (let i = 1; i <= map.Extent(); i++) yield acquire(map.FindKey_2(i));
  } finally {
    scope.close();
  }
}

type Owned = { delete(): void; isDeleted?(): boolean };
export type Own = {
  <H extends Owned>(handle: H): H;
  keep<H extends Owned>(handle: H): H;
};

let activeHandles: HandleScope | undefined;

export function acquire<H extends Owned>(handle: H): H {
  return activeHandles?.acquire(handle) ?? handle;
}

export function release(handles: Iterable<Owned>): void {
  let failed = false;
  let failure: unknown;
  for (const handle of [...handles].toReversed()) {
    try {
      if (!handle.isDeleted?.()) handle.delete();
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
  }
  if (failed) throw failure;
}

export class HandleScope {
  private readonly owned = new Set<Owned>();
  private readonly retained = new Set<Owned>();

  readonly acquire = <H extends Owned>(handle: H): H => {
    if (handle === range)
      throw new Error("the shared progress range cannot be owned");
    this.owned.add(handle);
    return handle;
  };

  readonly keep = <H extends Owned>(handle: H): H => {
    this.retained.add(handle);
    return handle;
  };

  close(failed = false): void {
    const escaped = failed
      ? []
      : [...this.retained].filter((handle) => this.owned.delete(handle));
    try {
      release(this.owned);
    } catch (error) {
      if (!failed) {
        try {
          release(escaped);
        } catch {
          throw error;
        }
        throw error;
      }
    } finally {
      this.owned.clear();
      this.retained.clear();
    }
  }
}

export function scoped<T>(fn: (own: Own) => T): T {
  const outer = activeHandles;
  const scope = new HandleScope();
  activeHandles = scope;
  let failed = false;
  try {
    return fn(Object.assign(scope.acquire, { keep: scope.keep }));
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    activeHandles = outer;
    scope.close(failed);
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
  return scoped((own) =>
    [...explore(shape, type)].map((found) => own.keep(own(cast(found)))),
  ).map(acquire);
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
  return acquire(
    scoped((own) => {
      const list = own(new (getKernel().TopTools_ListOfShape_1)());
      for (const shape of shapes) own(list.Append_1(shape));
      return own.keep(list);
    }),
  );
}

export function listToArray(list: any): Shape[] {
  if (!list) return [];
  return scoped((own) => {
    own(list);
    const out: Shape[] = [];
    while (list.Size() > 0) {
      out.push(own(list.First_1()));
      list.RemoveFirst();
    }
    return out.map(own.keep);
  }).map(acquire);
}

export function pnt(x: number, y: number, z: number): any {
  const k = getKernel();
  return acquire(new k.gp_Pnt_3(x, y, z));
}

export function dir(x: number, y: number, z: number): any {
  const k = getKernel();
  return acquire(new k.gp_Dir_5(x, y, z));
}

export function vec(x: number, y: number, z: number): any {
  const k = getKernel();
  return acquire(new k.gp_Vec_4(x, y, z));
}

export function placementToTrsf(placement: Placement): any {
  const k = getKernel();
  return acquire(
    scoped((own) => {
      const rotation = own(new k.gp_Quaternion_2(...placement.rotation));
      const translation = own(vec(...placement.translation));
      const trsf = own(new k.gp_Trsf_1());
      trsf.SetRotation_2(rotation);
      trsf.SetTranslationPart(translation);
      return own.keep(trsf);
    }),
  );
}

export function transformOp(shape: Shape, trsf: any, copyMesh = false): any {
  return acquire(
    new (getKernel().BRepBuilderAPI_Transform_2)(shape, trsf, true, copyMesh),
  );
}

export function progress(): any {
  getKernel();
  if (!cancel) return range;
  return cancel.owner.acquire(cancel.indicator.Start());
}

export const cancelRequested = (): boolean => cancel?.isCancelled() ?? false;

export function cancellable<T>(
  isCancelled: (() => boolean) | undefined,
  fn: () => T,
): T {
  if (!isCancelled) return fn();
  const outer = cancel;
  const owner = new HandleScope();
  const scope = {
    indicator: owner.acquire(new (getKernel().CancelIndicator)(isCancelled)),
    owner,
    isCancelled,
  };
  cancel = scope;
  let failed = false;
  try {
    return fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    cancel = outer;
    owner.close(failed);
  }
}

/** Volume of a solid shape in mm³. */
export function volumeOf(shape: Shape): number {
  return scoped((own) => {
    const k = getKernel();
    const props = own(new k.GProp_GProps_1());
    k.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    const v = props.Mass();

    return v;
  });
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
  return scoped((own) => {
    const k = getKernel();
    const props = own(new k.GProp_GProps_1());
    k.BRepGProp.SurfaceProperties_1(shape, props, false, false);
    const a = props.Mass();

    return a;
  });
}

/** Length of an edge/wire in mm. */
export function lengthOf(shape: Shape): number {
  return scoped((own) => {
    const k = getKernel();
    const props = own(new k.GProp_GProps_1());
    k.BRepGProp.LinearProperties(shape, props, false, false);
    const l = props.Mass();

    return l;
  });
}

export function diagonal({ min, max }: ReturnType<typeof bboxOf>): number {
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

export function bboxOf(
  shape: Shape,
  useShapeTolerance = true,
): {
  min: [number, number, number];
  max: [number, number, number];
} {
  return scoped((own) => {
    const k = getKernel();
    const box = own(new k.Bnd_Box_1());
    if (useShapeTolerance) k.BRepBndLib.Add(shape, box, false);
    else k.BRepBndLib.AddOptimal(shape, box, false, false);
    const cmin = own(box.CornerMin());
    const cmax = own(box.CornerMax());
    const result = {
      min: [cmin.X(), cmin.Y(), cmin.Z()] as [number, number, number],
      max: [cmax.X(), cmax.Y(), cmax.Z()] as [number, number, number],
    };

    return result;
  });
}

/** Centroid of a face (surface center of mass). */
export function faceCentroid(face: Shape): [number, number, number] {
  return scoped((own) => {
    const k = getKernel();
    const props = own(new k.GProp_GProps_1());
    k.BRepGProp.SurfaceProperties_1(face, props, false, false);
    const c = own(props.CentreOfMass());
    const out: [number, number, number] = [c.X(), c.Y(), c.Z()];

    return out;
  });
}

export function planarFacePlane(face: Shape): {
  origin: [number, number, number];
  normal: [number, number, number];
} | null {
  return scoped((own) => {
    const k = getKernel();
    const surf = own(new k.BRepAdaptor_Surface_2(face, false));
    if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Plane) {
      return null;
    }
    const pln = own(surf.Plane());
    const axis = own(pln.Axis());
    const position = own(pln.Position());
    const d = own(axis.Direction());
    const loc = own(pln.Location());
    const sgn =
      (face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1) *
      (position.Direct() ? 1 : -1);
    const out = {
      origin: [loc.X(), loc.Y(), loc.Z()] as [number, number, number],
      normal: [sgn * d.X(), sgn * d.Y(), sgn * d.Z()] as [
        number,
        number,
        number,
      ],
    };

    return out;
  });
}

export function edgeCentroid(edge: Shape): [number, number, number] {
  return scoped((own) => {
    const k = getKernel();
    const props = own(new k.GProp_GProps_1());
    k.BRepGProp.LinearProperties(edge, props, false, false);
    const c = own(props.CentreOfMass());
    const out: [number, number, number] = [c.X(), c.Y(), c.Z()];

    return out;
  });
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
