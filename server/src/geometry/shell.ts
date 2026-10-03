import {
  LINEAR_TOL,
  ValidationError,
  type Feature,
  type ShellFeature,
  type Vec3,
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
  pnt,
  progress,
  scoped,
  shapeHash,
  shapeList,
  solids,
  vec,
  volumeOf,
  type Shape,
} from "./kernel.js";
import { finalizeNames, findFace, propagateNames } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { fuseNamed, hollowedByCut } from "./boolean.js";
import { interiorUV } from "./cutValidation.js";
import { surfaceNormal } from "./signature.js";
import type { EvalContext } from "./featureKinds.js";
import {
  invalidPart,
  registerBodySolids,
  rejectInvalid,
  type EvalState,
  type StateBody,
  type ToolResult,
} from "./featureState.js";

interface Walls {
  inside: number;
  outside: number;
}

const KEPT = "the previous body has been kept";

class Blocked extends Error {}

function wallsOf(f: ShellFeature): Walls {
  const walls = {
    inside: { inside: f.thickness, outside: 0 },
    outside: { inside: 0, outside: f.thickness },
    both: { inside: f.thickness, outside: f.outsideThickness ?? 0 },
  }[f.direction];
  const used =
    f.direction === "both" ? [walls.inside, walls.outside] : [f.thickness];
  if (!used.every((t) => t > 0))
    throw new Error("shell thickness must be positive");
  return walls;
}

function sizeOf(f: ShellFeature): string {
  if (f.direction === "both")
    return `${f.thickness} mm inside and ${f.outsideThickness} mm outside`;
  return f.direction === "inside"
    ? `${f.thickness} mm`
    : `${f.thickness} mm outside`;
}

function hollowed(before: Shape, after: Shape): boolean {
  const skin = LINEAR_TOL * areaOf(before);
  const kept = volumeOf(after);
  return kept > skin && volumeOf(before) - kept > skin;
}

function thickSolid(shape: Shape, closing: Shape[], offset: number): any {
  const k = getKernel();
  const list = shapeList(closing);
  const op = acquire(new k.BRepOffsetAPI_MakeThickSolid());

  op.MakeThickSolidByJoin(
    shape,
    list,
    offset,
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

function offsetSolid(
  body: StateBody,
  offset: number,
  featureId: string,
): { op: any; solid: ToolResult } {
  const op = thickSolid(body.shape, [], offset);
  const made = acquire(op.Shape());
  const shape = volumeOf(made) < 0 ? acquire(made.Reversed()) : made;
  return {
    op,
    solid: { shape, names: propagateNames(op, [body], shape, featureId) },
  };
}

function closedShell(
  body: StateBody,
  offset: number,
  featureId: string,
): ToolResult | null {
  const { solid } = offsetSolid(body, offset, featureId);
  return offset < 0
    ? hollowedByCut(body, solid, featureId)
    : hollowedByCut({ ...body, ...solid }, body, featureId);
}

function openShell(
  body: StateBody,
  open: Shape[],
  offset: number,
  featureId: string,
): ToolResult {
  const op = thickSolid(body.shape, open, offset);
  const shape = acquire(op.Shape());
  return { shape, names: propagateNames(op, [body], shape, featureId) };
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
  const { op, solid: inner } = offsetSolid(body, -thickness, featureId);

  if (invalidPart(inner.shape) || !(volumeOf(inner.shape) > 0))
    throw new Error("shell failed: the inner wall could not be offset");
  const normals = open.map((face) => planarFacePlane(face)?.normal);
  let tool = inner;
  for (const [i, face] of open.entries()) {
    const normal = normals[i];
    const images = listToArray(op.Generated(face));
    if (images.length === 0) throw new Blocked();
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
  return hollowedByCut(body, tool, featureId);
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

function solidAt(shape: Shape, [x, y, z]: Vec3): boolean {
  const k = getKernel();
  return scoped((own) => {
    const vertex = own(
      own(new k.BRepBuilderAPI_MakeVertex(pnt(x, y, z))).Vertex(),
    );
    return solids(shape).some((solid) => {
      const dist = own(
        new k.BRepExtrema_DistShapeShape_2(
          solid,
          vertex,
          k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
          k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
          progress(),
        ),
      );
      if (!dist.IsDone())
        throw new Error("shell failed: could not probe the wall");
      return dist.InnerSolution();
    });
  });
}

function misplaced(
  body: Shape,
  open: Shape[],
  result: Shape,
  walls: Walls,
): string | null {
  const k = getKernel();
  return scoped((own) => {
    for (const face of facesOf(body).map(own)) {
      const surf = own(new k.BRepAdaptor_Surface_2(face, true));
      const uv = interiorUV(face, surf);
      if (!uv) continue;
      const { point, normal } = surfaceNormal(face, surf, uv);
      const opened = open.some((o) => o.IsSame(face));
      for (const depth of [-walls.inside / 2, walls.outside / 2]) {
        if (depth === 0) continue;
        const at = point.map((p, i) => p + normal[i]! * depth) as Vec3;
        if (solidAt(result, at) === opened)
          return opened
            ? "material still closes an opened face: open another face or try a thinner wall"
            : "a kept face has no wall of that thickness behind it: try a different wall thickness";
      }
    }
    return null;
  });
}

function qualify(
  body: StateBody,
  open: Shape[],
  built: ToolResult | null,
  walls: Walls,
  size: string,
): ToolResult {
  const noHollow = `shell of ${size} left no hollow, so the wall is too thick for this body: try a thinner wall; ${KEPT}`;
  if (!built) throw new Error(noHollow);
  rejectInvalid(
    built.shape,
    body.shape,
    "shell",
    size,
    "try a different wall thickness",
  );
  if (walls.outside === 0 && !hollowed(body.shape, built.shape))
    throw new Error(noHollow);
  const pieces = scoped(() => solids(built.shape).length);
  const whole = scoped(() => solids(body.shape).length);
  const fault =
    pieces === whole
      ? misplaced(body.shape, open, built.shape, walls)
      : `the result has ${pieces} solids where the body had ${whole}: try a different wall thickness`;
  if (fault)
    throw new Error(`shell of ${size} did not qualify: ${fault}; ${KEPT}`);
  return built;
}

function attempts(
  body: StateBody,
  open: Shape[],
  offset: number,
  featureId: string,
): (() => ToolResult | null)[] {
  if (open.length === 0) return [() => closedShell(body, offset, featureId)];
  const direct = () => openShell(body, open, offset, featureId);
  if (offset > 0) return [direct];
  return [direct, () => openedThroughWalls(body, open, -offset, featureId)];
}

function side(
  body: StateBody,
  open: Shape[],
  walls: Walls,
  f: ShellFeature,
  earlier: Feature[],
): ToolResult {
  const size = sizeOf(f);
  const offset = walls.outside - walls.inside;
  const failures: unknown[] = [];
  for (const attempt of attempts(body, open, offset, f.id)) {
    try {
      return kernelCall("shell", () =>
        qualify(body, open, attempt(), walls, size),
      );
    } catch (err) {
      failures.push(err);
    }
  }
  const [first, last] = [failures[0], failures.at(-1)];
  const blocked = last instanceof Error && last.cause instanceof Blocked;
  const blends = blocked
    ? kernelCall("shell", () => blendsBeside(body, open, earlier))
    : [];
  if (blends.length > 0)
    throw new Error(
      `shell: shell of ${size} cannot open the body at ${blends.join(", ")}: the kernel cannot offset that blend where the shell opens, so open another face or shell before the blend; ${KEPT}`,
    );
  if (!(first instanceof Error) || first.message.includes(KEPT)) throw first;
  const reason =
    first.cause instanceof WebAssembly.Exception
      ? `the kernel could not offset the walls by ${Math.abs(offset)} mm, which happens when a wall is thicker than a rounded face or a narrow part allows`
      : first.message.replace(/^shell: (shell failed: )?/, "");
  throw new Error(
    `shell: shell of ${size} failed: ${reason}: try a thinner wall; ${KEPT}`,
    { cause: first },
  );
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
  const walls = wallsOf(f);
  const body = shelledBody(state, f);
  const open = kernelCall("shell", () =>
    f.openFaces.map((ref) => {
      const face = findFace(body, ref.faceName);
      if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
      return face;
    }),
  );
  const parts = [
    { inside: walls.inside, outside: 0 },
    { inside: 0, outside: walls.outside },
  ]
    .filter((part) => part.inside + part.outside > 0)
    .map((part) => side(body, open, part, f, earlier));
  const [first, second] = parts;
  const built = second
    ? kernelCall("shell", () =>
        qualify(
          body,
          open,
          fuseNamed(
            first!,
            second,
            f.id,
            "shell failed: could not join the inside and outside walls",
          ),
          walls,
          sizeOf(f),
        ),
      )
    : first!;
  registerBodySolids(state, body.bodyId, built.shape, built.names);
}
