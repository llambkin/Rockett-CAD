/**
 * OCCT (OpenCascade) WASM kernel bootstrap and low-level helpers.
 *
 * The kernel is loaded once per process. All geometry code receives the
 * kernel instance via `getKernel()` after `initKernel()` resolves.
 */

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
    }
    ex.Next();
  }
  ex.delete();
}

export function faces(shape: Shape): Shape[] {
  const k = getKernel();
  return [...explore(shape, "face")].map((f) => k.TopoDS.Face_1(f));
}

export function edges(shape: Shape): Shape[] {
  const k = getKernel();
  return [...explore(shape, "edge")].map((e) => k.TopoDS.Edge_1(e));
}

export function vertices(shape: Shape): Shape[] {
  const k = getKernel();
  return [...explore(shape, "vertex")].map((v) => k.TopoDS.Vertex_1(v));
}

export function solids(shape: Shape): Shape[] {
  const k = getKernel();
  return [...explore(shape, "solid")].map((s) => k.TopoDS.Solid_1(s));
}

/** Convert a TopTools_ListOfShape to a JS array (does not delete the list). */
export function listToArray(list: any): Shape[] {
  const out: Shape[] = [];
  if (!list) return out;
  const size = list.Size();
  if (size === 0) return out;
  // NCollection lists expose iterators awkwardly through embind;
  // use First/RemoveFirst on a copy instead.
  const k = getKernel();
  const copy = new k.TopTools_ListOfShape_1();
  copy.Assign(list);
  for (let i = 0; i < size; i++) {
    out.push(copy.First_1());
    copy.RemoveFirst();
  }
  copy.delete();
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
