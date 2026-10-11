import {
  LINEAR_TOL,
  autoTarget,
  compareNames,
  startBody,
  type CombineFeature,
  type ExtrudeFeature,
  type LoftFeature,
  type OffsetFaceFeature,
  type RevolveFeature,
  type SweepFeature,
  type SplitBodyFeature,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  diagonal,
  faces as facesOf,
  getKernel,
  kernelCall,
  planarFacePlane,
  progress,
  scoped,
  shapeList,
  solids,
  type Shape,
} from "./kernel.js";
import { propagateNames, findFace, type NamedBody } from "./naming.js";
import { removesVolume } from "./cutValidation.js";
import { cutShape } from "./meshBody.js";
import { bboxOverlap, zeroThicknessWarning } from "./joinCheck.js";
import {
  registerBodySolids,
  registerSolids,
  registerSplitBodies,
  rejectInvalidBody,
  resolvePlaneFrame,
  type EvalState,
  type FeatureOutcome,
  type StateBody,
  type ToolResult,
} from "./featureState.js";
import {
  finishJoin,
  namedFuse,
  namedResult,
  overlapping,
  targetBody,
  missedTarget,
  warned,
  keptSplitEdges,
  namedSplitPieces,
  type JoinResult,
} from "./booleanNaming.js";
import {
  clippedEndBoxes,
  offsetFaceTool,
  splitPlaneFace,
  interiorSketchRegions,
  sketchRegionCompound,
  sketchRegionEdgeNames,
} from "./booleanTools.js";
import { ShapeMap } from "./shapeMap.js";
import type { SketchOnPlane } from "./sketchGeom.js";
export { unifyTool } from "./booleanNaming.js";

export type ToolFeature =
  ExtrudeFeature | RevolveFeature | SweepFeature | LoftFeature;

const OPERATION_LABEL = {
  newBody: "new body",
  join: "join",
  cut: "cut",
  intersect: "intersect",
} as const;

export const operationKind = (f: ToolFeature) =>
  `${f.type} ${OPERATION_LABEL[f.operation]}`;

export function fuseOperation(a: Shape, b: Shape): any {
  return acquire(new (getKernel().BRepAlgoAPI_Fuse_3)(a, b, progress()));
}

export function cutOperation(a: Shape, b: Shape): any {
  return acquire(new (getKernel().BRepAlgoAPI_Cut_3)(a, b, progress()));
}

export function commonOperation(a: Shape, b: Shape): any {
  return acquire(new (getKernel().BRepAlgoAPI_Common_3)(a, b, progress()));
}

export function checkedCut(body: Shape, tool: Shape, failed: string): any {
  const op = scoped((own) => {
    const cut = own(cutOperation(body, tool));
    if (!cut.IsDone()) throw new Error(failed);
    return removesVolume(cut, body, tool, own(cut.Shape()))
      ? own.keep(cut)
      : null;
  });
  return op && acquire(op);
}

export function fuseNamed(
  a: ToolResult,
  b: ToolResult,
  featureId: string,
  failure: string,
): ToolResult {
  const op = fuseOperation(a.shape, b.shape);
  op.Build(progress());
  if (op.IsDone()) return namedFuse(op, a, b, featureId);
  throw new Error(failure);
}

function contactFuse(a: Shape, b: Shape): any {
  if (!bboxOverlap(a, b)) return null;
  const k = getKernel();
  const dist = acquire(
    new k.BRepExtrema_DistShapeShape_2(
      a,
      b,
      k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      progress(),
    ),
  );
  const done = dist.IsDone();
  const value = done ? dist.Value() : 0;
  if (!done) throw new Error("join contact check failed");
  if (value > LINEAR_TOL) return null;
  const op = fuseOperation(a, b);
  op.Build(progress());
  const failed = !op.IsDone();
  if (!failed && scoped((own) => solids(own(op.Shape())).map(own).length === 1))
    return op;
  if (failed) throw new Error("join contact check failed");
  return "touch";
}

const TOUCH_WARNING =
  "join touches only along an edge or at a vertex; the bodies stay separate";

type JoinGroup = { bodies: StateBody[]; pieces: ToolResult[]; fuse: any };

function contactGroups(bodies: StateBody[], tool: ToolResult) {
  let groups: JoinGroup[] = [];
  let touching = false;
  const loose: Shape[] = [];
  for (const shape of solids(tool.shape)) {
    const hits = bodies.flatMap((body) => {
      const fuse = contactFuse(body.shape, shape);
      touching ||= fuse === "touch";
      if (!fuse || fuse === "touch") return [];
      return [{ body, fuse }];
    });
    if (hits.length === 0) {
      loose.push(shape);
      continue;
    }
    const hit = (b: StateBody) => hits.some((h) => h.body === b);
    const bridged = groups.filter((g) => g.bodies.some(hit));
    const joined = bodies.filter(
      (b) => hit(b) || bridged.some((g) => g.bodies.includes(b)),
    );
    const fuse = joined.length === 1 ? (bridged[0] ?? hits[0]!).fuse : null;
    groups = [
      ...groups.filter((g) => !bridged.includes(g)),
      {
        bodies: joined,
        pieces: [...bridged.flatMap((g) => g.pieces), { ...tool, shape }],
        fuse,
      },
    ];
  }
  return { groups, loose, warning: touching ? TOUCH_WARNING : undefined };
}

export function joinEvery(
  state: EvalState,
  f: ToolFeature,
  tool: ToolResult,
  targets?: string[],
): FeatureOutcome {
  const featureId = f.id;
  const kind = operationKind(f);
  const start = f.autoTargets && startBody(f);
  const bodies = targets
    ? targets.map((id) => targetBody(state, "join", id, tool.shape))
    : overlapping(state, tool.shape, f.autoTargets).toSorted(
        (a, b) =>
          Number(b.bodyId === start) - Number(a.bodyId === start) ||
          compareNames(a.bodyId, b.bodyId),
      );

  const { groups, loose, warning } = contactGroups(bodies, tool);
  const touched = new Set(groups.flatMap((g) => g.bodies));
  const used = bodies.filter((b) => touched.has(b)).map((b) => b.bodyId);
  const missed = targets?.find((id) => !used.includes(id));
  if (missed) {
    throw missedTarget("join", missed);
  }
  for (const shape of loose) rejectInvalidBody(kind, shape);
  if (loose.length > 0)
    registerSolids(state, `b:${featureId}`, loose, tool.names);
  const warnings: (string | undefined)[] = [warning];
  const join = (acc: ToolResult, next: ToolResult) =>
    fuseNamed(acc, next, featureId, "boolean join failed");
  for (const {
    bodies: [first, ...rest],
    pieces,
    fuse,
  } of groups) {
    const fused = fuse
      ? pieces
          .slice(1)
          .reduce(join, namedFuse(fuse, first!, pieces[0]!, featureId))
      : [...pieces, ...rest].reduce<ToolResult>(join, first!);
    for (const b of rest) state.bodies.delete(b.bodyId);
    const joined = finishJoin(fused, featureId, [first!, ...rest, ...pieces]);
    warnings.push(joined.warning);
    const { shape, names } = joined;
    rejectInvalidBody(kind, shape, first!.shape);
    registerBodySolids(state, first!.bodyId, shape, names, featureId);
  }
  return { targets: used, ...warned(warnings) };
}

export function applyToolOperation(
  state: EvalState,
  f: ToolFeature,
  tool: ToolResult,
): FeatureOutcome | void {
  const { id: featureId, operation, targets, autoTargets } = f;
  const kind = operationKind(f);
  const publishTool = () => {
    rejectInvalidBody(kind, tool.shape);
    registerBodySolids(state, `b:${featureId}`, tool.shape, tool.names);
  };
  if (operation === "newBody") return publishTool();
  if (targets?.length === 0 && operation !== "join")
    throw new Error(`${operation} has no target body`);
  const none =
    !targets &&
    ![...state.bodies.keys()].some((id) => autoTarget(autoTargets, id));
  if (targets?.length === 0 || none) {
    publishTool();
    if (operation !== "join") return;
    return { targets: [] };
  }

  if (operation === "join" && tool.names.version === 2)
    return joinEvery(state, f, tool, targets);

  if (operation === "cut") {
    const bodies = targets
      ? targets.map((id) => targetBody(state, "cut", id, tool.shape))
      : overlapping(state, tool.shape, autoTargets);
    if (bodies.length === 0)
      throw new Error("cut tool does not intersect any body");
    const warnings = bodies.map((body) => {
      const op = checkedCut(cutShape(body), tool.shape, "boolean cut failed");
      if (!op) return undefined;
      const result = acquire(op.Shape());
      const names = propagateNames(op, [body, tool], result, featureId);
      const inputs = [body.shape, tool.shape];
      const warning = zeroThicknessWarning("cut", result, inputs);
      rejectInvalidBody(kind, result, body.shape);
      registerBodySolids(state, body.bodyId, result, names, featureId);
      return warning;
    });
    return { targets: bodies.map((b) => b.bodyId), ...warned(warnings) };
  }

  const target = targets
    ? targetBody(state, operation, targets[0]!, tool.shape)
    : overlapping(state, tool.shape, autoTargets)[0];

  if (operation === "join") {
    if (!target) {
      publishTool();
      return { targets: [] };
    }
    const fused = fuseNamed(target, tool, featureId, "boolean join failed");
    const joined = finishJoin(fused, featureId, [target, tool], true);
    const { shape, names } = joined;
    rejectInvalidBody(kind, shape, target.shape);
    registerBodySolids(state, target.bodyId, shape, names, featureId);
    return { targets: [target.bodyId], ...warned([joined.warning]) };
  }

  if (!target) throw new Error("intersect tool does not overlap any body");
  const op = commonOperation(target.shape, tool.shape);
  op.Build(progress());
  if (!op.IsDone()) {
    throw new Error("boolean intersect failed");
  }
  const result = acquire(op.Shape());
  const names = propagateNames(
    op,
    [target, { shape: tool.shape, names: tool.names }],
    result,
    featureId,
  );
  rejectInvalidBody(kind, result, target.shape);
  registerBodySolids(state, target.bodyId, result, names, featureId);
  return { targets: [target.bodyId] };
}

export function evalCombine(state: EvalState, f: CombineFeature) {
  const target = state.bodies.get(f.targetBody);
  if (!target) throw new Error(`target body ${f.targetBody} not found`);
  const tools = f.toolBodies.map((id) => {
    const b = state.bodies.get(id);
    if (!b) throw new Error(`tool body ${id} not found`);
    return b;
  });
  if (tools.length === 0) throw new Error("no tool bodies selected");
  return kernelCall("combine", () => {
    let current: NamedBody = target;
    for (const tool of tools) {
      let op: any;
      if (f.operation === "join") {
        op = fuseOperation(current.shape, tool.shape);
      } else if (f.operation === "cut") {
        op = checkedCut(cutShape(current), tool.shape, "boolean cut failed");
      } else {
        op = commonOperation(current.shape, tool.shape);
      }
      if (!op) continue;
      if (!op.IsDone()) {
        throw new Error(`boolean ${f.operation} failed`);
      }
      current = {
        bodyId: target.bodyId,
        ...namedResult(op, [current, tool], f.id),
      };
    }
    const joined: JoinResult =
      f.operation === "join"
        ? finishJoin(current, f.id, [target, ...tools])
        : current;
    rejectInvalidBody(`combine ${f.operation}`, joined.shape, target.shape);
    registerBodySolids(state, target.bodyId, joined.shape, joined.names);
    if (!f.keepTools) {
      for (const tool of tools) state.bodies.delete(tool.bodyId);
    }
    return warned([joined.warning]);
  });
}

export function evalOffsetFace(state: EvalState, f: OffsetFaceFeature) {
  if (f.faces.length === 0) throw new Error("no faces selected");
  if (f.distance === 0) throw new Error("offset distance must be non-zero");
  const bodyId = f.faces[0]!.bodyId;
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(`body ${bodyId} not found`);
  return kernelCall("offsetFace", () => {
    let current = body;
    for (const ref of f.faces) {
      const face = findFace(current, ref.faceName);
      if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
      const plane = planarFacePlane(face);
      if (!plane) throw new Error("offset face requires a planar face");
      const normal = plane.normal;
      const outward = f.distance > 0;
      const { shape: toolShape, names: toolNames } = offsetFaceTool(
        current,
        face,
        normal,
        f.distance,
        ref.faceName,
        f.id,
      );
      const op = outward
        ? fuseOperation(current.shape, toolShape)
        : checkedCut(current.shape, toolShape, "offset face boolean failed");
      if (!op) continue;
      if (!op.IsDone()) {
        throw new Error("offset face boolean failed");
      }
      current = {
        bodyId,
        ...namedResult(
          op,
          [current, { shape: toolShape, names: toolNames }],
          f.id,
        ),
      };
    }
    const joined: JoinResult =
      f.distance > 0 ? finishJoin(current, f.id, [body]) : current;
    registerBodySolids(state, bodyId, joined.shape, joined.names);
    return warned([joined.warning]);
  });
}

export function evalSplitBody(state: EvalState, f: SplitBodyFeature): void {
  const body = state.bodies.get(f.body);
  if (!body) throw new Error(`body ${f.body} not found`);
  const frame = resolvePlaneFrame(state, f.tool);
  const k = getKernel();
  kernelCall("splitBody", () => {
    const diag = diagonal(bboxOf(body.shape)) + 10;
    const toolFace = splitPlaneFace(frame, diag, acquire);
    const splitter = acquire(new k.BRepAlgoAPI_Splitter_1());
    splitter.SetArguments(shapeList([body.shape]));
    splitter.SetTools(shapeList([toolFace]));
    splitter.Build(progress());
    if (!splitter.IsDone()) throw new Error("split failed");
    const result = acquire(splitter.Shape());
    const names = propagateNames(splitter, [body], result, f.id);
    const sols = solids(result);
    if (sols.length < 2)
      throw new Error("split plane does not intersect the body");
    registerSplitBodies(state, f.body, f.id, sols, names, frame.normal);
  });
}

export function hollowedByCut(
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
  const shape = acquire(cut.Shape());
  const names = propagateNames(cut, [body, inner], shape, featureId);
  return { shape, names };
}

export function splitAtEnds(
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  ends: { at: Vec3; out: Vec3 }[],
  featureId: string,
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const beyond = clippedEndBoxes(body, ends, own).reduce((a, b) =>
    own(own(fuseOperation(a, b)).Shape()),
  );
  const cut = own(cutOperation(body.shape, beyond));
  const common = own(commonOperation(body.shape, beyond));
  if (!cut.IsDone() || !common.IsDone()) return null;
  const kept = keptSplitEdges(cut, sourceEdges, own);
  if (!kept) return null;
  const { piece, rest } = namedSplitPieces(
    cut,
    common,
    body,
    beyond,
    featureId,
    own,
  );
  return { piece: piece!, rest: rest!, kept: kept as { edge: Shape }[] };
}

export function subtractSketchRegionsFromFace(
  face: Shape,
  sketches: Iterable<SketchOnPlane>,
): { face: Shape; edgeEntity: ShapeMap<string> } {
  const regions = interiorSketchRegions(face, sketches);
  if (regions.length === 0) return { face, edgeEntity: new ShapeMap() };
  return kernelCall("face region subtraction", () => {
    const op = cutOperation(face, sketchRegionCompound(regions));
    if (!op.IsDone()) throw new Error("the kernel could not cut the regions");
    const cutFaces = facesOf(acquire(op.Shape()));
    if (cutFaces.length !== 1)
      throw new Error(`the face split into ${cutFaces.length} pieces`);
    const edgeEntity = sketchRegionEdgeNames(cutFaces[0]!, regions);
    return { face: cutFaces[0]!, edgeEntity };
  });
}
