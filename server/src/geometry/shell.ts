import { LINEAR_TOL, type Feature, type ShellFeature } from "@rockett/shared";
import {
  areaOf,
  edges as edgesOf,
  faces as facesOf,
  getKernel,
  kernelCall,
  listToArray,
  planarFacePlane,
  progress,
  release,
  shapeHash,
  shapeList,
  vec,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { finalizeNames, findFace, propagateNames } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { checkedCut } from "./cutCheck.js";
import type { EvalContext } from "./featureKinds.js";
import {
  fuseNamed,
  invalidPart,
  registerBodySolids,
  rejectInvalid,
  type StateBody,
  type ToolResult,
} from "./features.js";

function hollowed(before: Shape, after: Shape): boolean {
  const skin = LINEAR_TOL * areaOf(before);
  const kept = volumeOf(after);
  return kept > skin && volumeOf(before) - kept > skin;
}

function thickSolid(shape: Shape, closing: Shape[], thickness: number): any {
  const k = getKernel();
  const list = shapeList(closing);
  const op = new k.BRepOffsetAPI_MakeThickSolid();
  try {
    op.MakeThickSolidByJoin(
      shape,
      list,
      -thickness,
      LINEAR_TOL,
      k.BRepOffset_Mode.BRepOffset_Skin,
      true,
      false,
      k.GeomAbs_JoinType.GeomAbs_Arc,
      false,
      progress(),
    );
    op.Build(progress());
  } finally {
    list.delete();
  }
  if (op.IsDone()) return op;
  op.delete();
  throw new Error("shell failed: thickness may be too large");
}

function hollowedByCut(
  body: StateBody,
  inner: ToolResult,
  featureId: string,
): ToolResult | null {
  const cut = checkedCut(
    body.shape,
    inner.shape,
    "shell failed: could not hollow the closed body",
  );
  if (!cut) return null;
  const shape = cut.Shape();
  const names = propagateNames(cut, [body, inner], shape, featureId);
  cut.delete();
  return { shape, names };
}

function offsetInside(
  body: StateBody,
  thickness: number,
  featureId: string,
): { op: any; inner: ToolResult } {
  const op = thickSolid(body.shape, [], thickness);
  const shape = op.Shape();
  return {
    op,
    inner: { shape, names: propagateNames(op, [body], shape, featureId) },
  };
}

function prismed(
  image: Shape,
  [x, y, z]: [number, number, number],
  thickness: number,
): Shape {
  const k = getKernel();
  const v = vec(x * thickness, y * thickness, z * thickness);
  const prism = new k.BRepPrimAPI_MakePrism_1(image, v, false, true);
  const slab = prism.Shape();
  prism.delete();
  v.delete();
  return slab;
}

function thickened(image: Shape, thickness: number): Shape {
  const op = new (getKernel().BRepOffsetAPI_MakeThickSolid)();
  try {
    op.MakeThickSolidBySimple(image, thickness);
    if (!op.IsDone()) throw new Error("shell failed: could not open the wall");
    const slab = op.Shape();
    if (volumeOf(slab) > 0) return slab;
    const outward = slab.Reversed();
    slab.delete();
    return outward;
  } finally {
    op.delete();
  }
}

function openedThroughWalls(
  body: StateBody,
  open: Shape[],
  thickness: number,
  featureId: string,
): ToolResult | null {
  const { op, inner } = offsetInside(body, thickness, featureId);
  try {
    if (invalidPart(inner.shape) || !(volumeOf(inner.shape) > 0))
      throw new Error("shell failed: the inner wall could not be offset");
    const normals = open.map((face) => planarFacePlane(face)?.normal);
    let tool = inner;
    for (const [i, face] of open.entries()) {
      const normal = normals[i];
      const images = listToArray(op.Generated(face));
      if (images.length === 0) return null;
      for (const image of images) {
        const slab = normal
          ? prismed(image, normal, thickness)
          : thickened(image, thickness);
        tool = fuseNamed(
          tool,
          {
            shape: slab,
            names: finalizeNames(slab, new ShapeMap(), featureId),
          },
          featureId,
          "shell failed: could not open the wall",
        );
      }
      release(images);
    }
    const opened = hollowedByCut(body, tool, featureId);
    if (!opened) throw new Error("shell failed: opening left no hollow");
    return opened;
  } finally {
    op.delete();
  }
}

function blendsBeside(
  body: StateBody,
  open: Shape[],
  earlier: Feature[],
): string[] {
  const blends = new Map(
    earlier
      .filter((e) => e.type === "fillet" || e.type === "chamfer")
      .map((e) => [e.id, e.name]),
  );
  const owners = (shapes: Shape[]) => [
    ...new Set(
      shapes
        .map((face) => blends.get(body.names.get(face)?.split(":")[1] ?? ""))
        .filter((name): name is string => name !== undefined),
    ),
  ];
  const opened = owners(open);
  if (opened.length > 0) return opened;
  const rims = new Set(open.flatMap((face) => edgesOf(face).map(shapeHash)));
  const all = facesOf(body.shape);
  try {
    return owners(
      all.filter((face) => edgesOf(face).some((e) => rims.has(shapeHash(e)))),
    );
  } finally {
    release(all);
  }
}

export function evalShell(
  { state, earlier }: EvalContext,
  f: ShellFeature,
): void {
  if (f.thickness <= 0) throw new Error("shell thickness must be positive");
  const bodyId = f.openFaces[0]?.bodyId ?? [...state.bodies.keys()][0];
  const body = bodyId === undefined ? undefined : state.bodies.get(bodyId);
  if (bodyId === undefined || !body) throw new Error("no body to shell");
  const noHollow = `shell of ${f.thickness} mm left no hollow, so the wall is too thick for this body: try a thinner wall; the previous body has been kept`;
  const publishable = (built: ToolResult | null): ToolResult => {
    if (!built) throw new Error(noHollow);
    try {
      rejectInvalid(
        built.shape,
        body.shape,
        "shell",
        `${f.thickness} mm`,
        "try a different wall thickness",
      );
      if (!hollowed(body.shape, built.shape)) throw new Error(noHollow);
    } catch (err) {
      built.shape.delete();
      throw err;
    }
    return built;
  };
  const publish = (built: ToolResult) =>
    registerBodySolids(state, bodyId, built.shape, built.names);
  const open = kernelCall("shell", () =>
    f.openFaces.map((ref) => {
      const face = findFace(body, ref.faceName);
      if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
      return face;
    }),
  );
  if (open.length === 0)
    return kernelCall("shell", () => {
      const { op, inner } = offsetInside(body, f.thickness, f.id);
      op.delete();
      publish(publishable(hollowedByCut(body, inner, f.id)));
    });
  let failure: unknown;
  let built: ToolResult | null = null;
  try {
    built = kernelCall("shell", () => {
      const op = thickSolid(body.shape, open, f.thickness);
      const shape = op.Shape();
      const names = propagateNames(op, [body], shape, f.id);
      op.delete();
      return publishable({ shape, names });
    });
  } catch (err) {
    failure = err;
  }
  if (built) return publish(built);
  try {
    built = kernelCall("shell", () => {
      const opened = openedThroughWalls(body, open, f.thickness, f.id);
      return opened && publishable(opened);
    });
  } catch {
    throw failure;
  }
  if (built) return publish(built);
  const blends = kernelCall("shell", () => blendsBeside(body, open, earlier));
  if (blends.length === 0) throw failure;
  throw new Error(
    `shell: shell of ${f.thickness} mm cannot open the body at ${blends.join(", ")}: the kernel cannot offset that blend where the shell opens, so open another face or shell before the blend; the previous body has been kept`,
  );
}
