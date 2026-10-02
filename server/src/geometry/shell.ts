import {
  LINEAR_TOL,
  ValidationError,
  type Feature,
  type ShellFeature,
} from "@rockett/shared";
import {
  acquire,
  areaOf,
  edges as edgesOf,
  faces as facesOf,
  getKernel,
  kernelCall,
  listToArray,
  planarFacePlane,
  progress,
  scoped,
  shapeHash,
  shapeList,
  vec,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { finalizeNames, findFace, propagateNames } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { fuseNamed, hollowedByCut } from "./boolean.js";
import type { EvalContext } from "./featureKinds.js";
import {
  invalidPart,
  registerBodySolids,
  rejectInvalid,
  type EvalState,
  type StateBody,
  type ToolResult,
} from "./featureState.js";

function hollowed(before: Shape, after: Shape): boolean {
  const skin = LINEAR_TOL * areaOf(before);
  const kept = volumeOf(after);
  return kept > skin && volumeOf(before) - kept > skin;
}

function thickSolid(shape: Shape, closing: Shape[], thickness: number): any {
  const k = getKernel();
  const list = shapeList(closing);
  const op = acquire(new k.BRepOffsetAPI_MakeThickSolid());

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

  if (op.IsDone()) return op;
  throw new Error("shell failed: thickness may be too large");
}

function offsetInside(
  body: StateBody,
  thickness: number,
  featureId: string,
): { op: any; inner: ToolResult } {
  const op = thickSolid(body.shape, [], thickness);
  const shape = acquire(op.Shape());
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
  const prism = acquire(new k.BRepPrimAPI_MakePrism_1(image, v, false, true));
  const slab = acquire(prism.Shape());
  return slab;
}

function thickened(image: Shape, thickness: number): Shape {
  const op = acquire(new (getKernel().BRepOffsetAPI_MakeThickSolid)());

  op.MakeThickSolidBySimple(image, thickness);
  if (!op.IsDone()) throw new Error("shell failed: could not open the wall");
  const slab = acquire(op.Shape());
  if (volumeOf(slab) > 0) return slab;
  const outward = acquire(slab.Reversed());
  return outward;
}

function openedThroughWalls(
  body: StateBody,
  open: Shape[],
  thickness: number,
  featureId: string,
): ToolResult | null {
  const { op, inner } = offsetInside(body, thickness, featureId);

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
  }
  const opened = hollowedByCut(body, tool, featureId);
  if (!opened) throw new Error("shell failed: opening left no hollow");
  return opened;
}

function blendsBeside(
  body: StateBody,
  open: Shape[],
  earlier: Feature[],
): string[] {
  return scoped(() => {
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

    return owners(
      all.filter((face) => edgesOf(face).some((e) => rims.has(shapeHash(e)))),
    );
  });
}

export function shelledBody(state: EvalState, f: ShellFeature): StateBody {
  if (f.body !== undefined && f.openFaces.some((r) => r.bodyId !== f.body))
    throw new ValidationError("shell faces must be on the chosen body");
  const bodyId = f.body ?? f.openFaces[0]?.bodyId;
  const body =
    bodyId === undefined
      ? state.bodies.values().next().value
      : state.bodies.get(bodyId);
  if (!body) throw new ValidationError("no body to shell");
  return body;
}

export function evalShell(
  { state, earlier }: EvalContext,
  f: ShellFeature,
): void {
  if (f.thickness <= 0) throw new Error("shell thickness must be positive");
  const body = shelledBody(state, f);
  const noHollow = `shell of ${f.thickness} mm left no hollow, so the wall is too thick for this body: try a thinner wall; the previous body has been kept`;
  const publishable = (built: ToolResult | null): ToolResult => {
    if (!built) throw new Error(noHollow);

    rejectInvalid(
      built.shape,
      body.shape,
      "shell",
      `${f.thickness} mm`,
      "try a different wall thickness",
    );
    if (!hollowed(body.shape, built.shape)) throw new Error(noHollow);

    return built;
  };
  const publish = (built: ToolResult) =>
    registerBodySolids(state, body.bodyId, built.shape, built.names);
  const open = kernelCall("shell", () =>
    f.openFaces.map((ref) => {
      const face = findFace(body, ref.faceName);
      if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
      return face;
    }),
  );
  if (open.length === 0)
    return kernelCall("shell", () => {
      const { inner } = offsetInside(body, f.thickness, f.id);
      publish(publishable(hollowedByCut(body, inner, f.id)));
    });
  let failure: unknown;
  let built: ToolResult | null = null;
  try {
    built = kernelCall("shell", () => {
      const op = thickSolid(body.shape, open, f.thickness);
      const shape = acquire(op.Shape());
      const names = propagateNames(op, [body], shape, f.id);
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
