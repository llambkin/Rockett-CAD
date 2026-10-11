import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type EmbossFeature,
  type ExtrudeFeature,
  type PlaneRef,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  diagonal,
  faces as facesOf,
  getKernel,
  kernelCall,
  progress,
  scoped,
  solids,
  vec,
  type Shape,
} from "./kernel.js";
import { capName, NameMap, namingVersion, propagateNames } from "./naming.js";
import { V, frameFromPlane } from "./frames.js";
import { commonOperation, cutOperation } from "./boolean.js";
import { namedResult } from "./booleanNaming.js";
import { splitPlaneFace } from "./booleanTools.js";
import {
  resolvePlaneFrame,
  type EvalState,
  type ToolResult,
} from "./featureState.js";
import {
  applyProfileTools,
  buildPrism,
  faceProfile,
  resolveProfiles,
} from "./features.js";
import type { ProfileFace } from "./sketchGeom.js";
import { taperedPrism } from "./taper.js";
import { thinSources } from "./thin.js";

const TO_OBJECT_MARGIN = 1;
const ORIGIN: Vec3 = [0, 0, 0];

const ONE_SIDE = "To object extends one side; choose One side";
const NOTHING_AHEAD =
  "All finds no body ahead of the profile; reverse the direction or use Distance";
const PARALLEL =
  "the To object plane is parallel to the extrude direction; pick a plane the profile can reach";
const CROSSES =
  "the To object plane crosses or touches the profile; pick a plane on one side of it";
const missing = (bodyId: string) => `body ${bodyId} no longer exists`;
const level = (bodyId: string) =>
  `body ${bodyId} is level with the profile; To object needs it on one side`;
const startsInside = (bodyId: string) =>
  `the profile starts inside body ${bodyId}; move it or use Distance`;
const misses = (bodyId: string) =>
  `the profile does not fully meet body ${bodyId}`;
const START_PARALLEL =
  "the Start object is parallel to the extrude direction; pick a plane the profile can reach";
const MEETS_START =
  "the To object plane meets the Start object over the profile; pick planes apart there";
const TAPER_SLANTED =
  "a taper needs a Start object parallel to the profile; use Profile plane or Offset";

interface Plane {
  origin: Vec3;
  normal: Vec3;
}

interface Source {
  pf: ProfileFace;
  n: Vec3;
  copy: boolean;
}

export function evalExtrude(state: EvalState, f: ExtrudeFeature) {
  const dist = Math.abs(f.distance);
  if (dist <= 0) throw new Error("extrude distance must be non-zero");
  const faceRefs = f.faces ?? [];
  if (f.profiles.length + faceRefs.length + (f.curves?.length ?? 0) === 0)
    throw new Error("select at least one profile, planar face or curve");
  const to = f.extent?.kind === "toObject" ? f.extent.object : null;
  if (to && (f.direction === "symmetric" || f.direction === "twoSided"))
    throw new Error(ONE_SIDE);

  const sources: Source[] = [];
  if (f.profiles.length > 0) {
    const { faces: profileFaces, sketch } = resolveProfiles(state, f.profiles);
    for (const pf of profileFaces) {
      sources.push({ pf, n: sketch.frame.normal, copy: false });
    }
  }
  for (const ref of faceRefs)
    sources.push({ ...faceProfile(state, ref), copy: true });

  const built = f.thin ? thinSources(state, f, f.thin, sources) : sources;
  const tools = built.map((s) =>
    f.startObject
      ? startTool(state, f, f.startObject, s)
      : !to
        ? prismTool(state, f, s)
        : to.kind === "body"
          ? bodyTool(state, f, to.bodyId, s)
          : planeTool(state, f, to, s),
  );
  return applyProfileTools(
    state,
    f,
    tools,
    built.map((s) => s.pf),
  );
}

function prismTool(state: EvalState, f: ExtrudeFeature, s: Source) {
  const sgn = (f.direction === "reverse" ? -1 : 1) * (f.distance < 0 ? -1 : 1);
  const n = V.scale(s.n, sgn);
  const base = (f.startOffset ?? 0) * sgn;
  const [ahead, behind] = spans(state, f, s.pf, n, base);
  return prismOf(f, s, n, ahead + behind, base - behind, base);
}

const tan = (deg = 0) => Math.tan((deg * Math.PI) / 180);

function slopes(f: ExtrudeFeature): [number, number] {
  const ahead = tan(f.taper);
  if (f.direction === "symmetric") return [ahead, ahead];
  return [ahead, f.direction === "twoSided" ? tan(f.taper2) : 0];
}

function prismOf(
  f: ExtrudeFeature,
  s: Source,
  n: Vec3,
  length: number,
  base: number,
  anchor = base,
): ToolResult {
  const [ahead, behind] = slopes(f);
  if (ahead === 0 && behind === 0)
    return buildPrism(f.id, s.pf, n, length, base, s.copy);
  const end = base + length;
  const inside = anchor - base > LINEAR_TOL && end - anchor > LINEAR_TOL;
  const at = [base, ...(inside ? [anchor] : []), end];
  return taperedPrism(
    f.id,
    s.pf,
    n,
    at.map((t) => ({
      at: t,
      offset: t >= anchor ? (t - anchor) * ahead : (anchor - t) * behind,
    })),
  );
}

function anchorOf(f: ExtrudeFeature, s: Source, n: Vec3, plane: Plane) {
  if (slopes(f).every((k) => k === 0)) return 0;
  const [lo, hi] = tRange(s.pf, n, plane);
  if (hi - lo > LINEAR_TOL) throw new Error(TAPER_SLANTED);
  return lo;
}

function spans(
  state: EvalState,
  f: ExtrudeFeature,
  pf: ProfileFace,
  n: Vec3,
  base: number,
): [number, number] {
  const dist = Math.abs(f.distance);
  const d2 = Math.abs(f.distance2 ?? 0);
  if (f.extent?.kind !== "all") {
    if (f.direction === "symmetric") return [dist / 2, dist / 2];
    return [dist, f.direction === "twoSided" ? d2 : 0];
  }
  const start = along(pf.face, n)[0] + base;
  const extents = [...state.bodies.values()].map((b) => along(b.shape, n));
  const ahead = Math.max(...extents.map(([, hi]) => hi - start));
  const behind =
    f.direction === "symmetric"
      ? Math.max(0, ...extents.map(([lo]) => start - lo))
      : f.direction === "twoSided"
        ? d2
        : 0;
  if (!(ahead > LINEAR_TOL) && !(f.direction === "symmetric" && behind > 0))
    throw new Error(NOTHING_AHEAD);
  return [Math.max(ahead, 0), behind];
}

function along(shape: Shape, normal: Vec3, origin = ORIGIN): [number, number] {
  const { xAxis, yAxis, normal: z } = frameFromPlane(origin, normal);
  const k = getKernel();
  return scoped((own) => {
    const trsf = own(new k.gp_Trsf_1());
    trsf.SetValues(
      ...xAxis,
      -V.dot(xAxis, origin),
      ...yAxis,
      -V.dot(yAxis, origin),
      ...z,
      -V.dot(z, origin),
    );
    const moved = own(shape.Moved(own(new k.TopLoc_Location_4(trsf)), false));
    const { min, max } = bboxOf(moved, false);
    return [min[2], max[2]];
  });
}

function planeTool(
  state: EvalState,
  f: ExtrudeFeature,
  object: PlaneRef,
  s: Source,
): ToolResult {
  const frame = resolvePlaneFrame(state, object);
  const m = frame.normal;
  const slope = V.dot(s.n, m);
  if (Math.abs(slope) < UNIT_DOT_TOL) throw new Error(PARALLEL);
  const offset = f.startOffset ?? 0;
  const [lo, hi] = along(s.pf.face, m, frame.origin).map(
    (d) => d + offset * slope,
  ) as [number, number];
  if (lo <= LINEAR_TOL && hi >= -LINEAR_TOL) throw new Error(CROSSES);
  const above = lo > 0 ? 1 : -1;
  const side = -above * Math.sign(slope);
  const reach = Math.max(Math.abs(lo), Math.abs(hi)) / Math.abs(slope);
  const n = V.scale(s.n, side);
  const prism = prismOf(f, s, n, reach + TO_OBJECT_MARGIN, offset * side);
  return kernelCall("extrude to object", () =>
    clipAtPlane(prism, frame.origin, V.scale(m, above), f.id),
  );
}

function clipAtPlane(
  prism: ToolResult,
  origin: Vec3,
  toProfile: Vec3,
  featureId: string,
  cap: "start" | "end" = "end",
): ToolResult {
  const k = getKernel();
  const box = bboxOf(prism.shape, false);
  const size = 2 * diagonal(box) + TO_OBJECT_MARGIN;
  const centre = V.scale(V.add(box.min, box.max), 0.5);
  const foot = V.sub(
    centre,
    V.scale(toProfile, V.dot(V.sub(centre, origin), toProfile)),
  );
  const frame = { ...frameFromPlane(foot, toProfile), origin: foot };
  const face = splitPlaneFace(frame, size, acquire);
  const half = acquire(
    new k.BRepPrimAPI_MakePrism_1(
      face,
      vec(...V.scale(toProfile, size)),
      false,
      true,
    ),
  );
  half.Build(progress());
  if (!half.IsDone()) throw new Error("the To object plane solid failed");
  const halfSpace = acquire(half.Shape());
  const op = commonOperation(prism.shape, halfSpace);
  if (!op.IsDone()) throw new Error("trimming at the To object plane failed");
  return namedResult(
    op,
    [prism, { shape: halfSpace, names: endNames(halfSpace, featureId, cap) }],
    featureId,
  );
}

function endNames(
  shape: Shape,
  featureId: string,
  cap: "start" | "end" = "end",
) {
  const names = new NameMap(namingVersion());
  for (const face of facesOf(shape)) names.set(face, capName(featureId, cap));
  return names;
}

function bodyTool(
  state: EvalState,
  f: ExtrudeFeature,
  bodyId: string,
  s: Source,
): ToolResult {
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(missing(bodyId));
  const offset = f.startOffset ?? 0;
  const start = along(s.pf.face, s.n)[0] + offset;
  const [lo, hi] = along(body.shape, s.n).map((d) => d - start) as [
    number,
    number,
  ];
  if (Math.abs(lo + hi) / 2 <= LINEAR_TOL) throw new Error(level(bodyId));
  const side = lo + hi > 0 ? 1 : -1;
  const n = V.scale(s.n, side);
  const length = (side > 0 ? hi : -lo) + TO_OBJECT_MARGIN;
  const prism = prismOf(f, s, n, length, offset * side);
  const near = start * side;
  return stopAtBody(
    f.id,
    prism,
    body.shape,
    bodyId,
    (p) => along(p, n)[0] - near <= LINEAR_TOL,
    (p) => along(p, n)[1] - near >= length - LINEAR_TOL,
  );
}

function stopAtBody(
  featureId: string,
  prism: ToolResult,
  body: Shape,
  bodyId: string,
  atStart: (piece: Shape) => boolean,
  atFar: (piece: Shape) => boolean,
): ToolResult {
  const cut = kernelCall("extrude to object", () => {
    const op = cutOperation(prism.shape, body);
    if (!op.IsDone()) throw new Error("cutting at the To object body failed");
    const pieces = solids(acquire(op.Shape())).filter(atStart);
    if (pieces.length !== 1) return { error: startsInside(bodyId) };
    const piece = pieces[0]!;
    if (atFar(piece)) return { error: misses(bodyId) };
    const names = propagateNames(
      op,
      [prism, { shape: body, names: endNames(body, featureId) }],
      piece,
      featureId,
    );
    return { shape: piece, names };
  });
  if ("error" in cut) throw new Error(cut.error);
  return cut;
}

function startTool(
  state: EvalState,
  f: ExtrudeFeature,
  object: PlaneRef,
  s: Source,
): ToolResult {
  const frame = resolvePlaneFrame(state, object);
  const start = {
    origin: V.add(frame.origin, V.scale(s.n, f.startOffset ?? 0)),
    normal: frame.normal,
  };
  const to = f.extent?.kind === "toObject" ? f.extent.object : null;
  if (to?.kind === "body") return startToBody(state, f, start, to.bodyId, s);
  if (to) {
    const target = resolvePlaneFrame(state, to);
    const [lo, hi] = gap(
      s.pf,
      s.n,
      facing(start, s.n, START_PARALLEL),
      facing(target, s.n, PARALLEL),
    );
    if (lo <= LINEAR_TOL && hi >= -LINEAR_TOL) throw new Error(MEETS_START);
    const n = V.scale(s.n, lo > 0 ? 1 : -1);
    const lower = facing(start, n, START_PARALLEL);
    return between(
      f,
      s,
      n,
      [lower, facing(target, n, PARALLEL)],
      anchorOf(f, s, n, lower),
    );
  }
  if (f.extent?.kind === "all" && f.direction === "symmetric")
    return prismTool(state, f, s);
  const sgn = (f.direction === "reverse" ? -1 : 1) * (f.distance < 0 ? -1 : 1);
  const n = V.scale(s.n, sgn);
  const plane = facing(start, n, START_PARALLEL);
  const [ahead, behind] = spans(state, f, s.pf, n, 0);
  const lower = shifted(plane, n, -behind);
  const anchor = anchorOf(f, s, n, plane);
  if (f.extent?.kind !== "all")
    return between(f, s, n, [lower, shifted(plane, n, ahead)], anchor);
  if (!(ahead > tRange(s.pf, n, plane)[1] + LINEAR_TOL))
    throw new Error(NOTHING_AHEAD);
  return between(f, s, n, [lower, ahead], anchor);
}

function startToBody(
  state: EvalState,
  f: ExtrudeFeature,
  start: Plane,
  bodyId: string,
  s: Source,
): ToolResult {
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(missing(bodyId));
  const plane = facing(start, s.n, START_PARALLEL);
  const [lo, hi] = along(body.shape, plane.normal, plane.origin);
  if (Math.abs(lo + hi) / 2 <= LINEAR_TOL) throw new Error(level(bodyId));
  const n = V.scale(s.n, lo + hi > 0 ? 1 : -1);
  const lower = facing(start, n, START_PARALLEL);
  const far =
    along(body.shape, n)[1] - along(s.pf.face, n)[0] + TO_OBJECT_MARGIN;
  if (!(far > tRange(s.pf, n, lower)[1] + LINEAR_TOL))
    throw new Error(misses(bodyId));
  const prism = between(f, s, n, [lower, far], anchorOf(f, s, n, lower));
  const end = along(prism.shape, n)[1];
  return stopAtBody(
    f.id,
    prism,
    body.shape,
    bodyId,
    (p) => along(p, lower.normal, lower.origin)[0] <= LINEAR_TOL,
    (p) => along(p, n)[1] >= end - LINEAR_TOL,
  );
}

function facing(plane: Plane, n: Vec3, parallel: string): Plane {
  const k = V.dot(n, plane.normal);
  if (Math.abs(k) < UNIT_DOT_TOL) throw new Error(parallel);
  return k > 0 ? plane : { ...plane, normal: V.scale(plane.normal, -1) };
}

function shifted(plane: Plane, n: Vec3, t: number): Plane {
  return { ...plane, origin: V.add(plane.origin, V.scale(n, t)) };
}

function tRange(pf: ProfileFace, n: Vec3, plane: Plane): [number, number] {
  const k = V.dot(n, plane.normal);
  const [lo, hi] = along(pf.face, plane.normal, plane.origin);
  return [-hi / k, -lo / k];
}

function gap(
  pf: ProfileFace,
  n: Vec3,
  lower: Plane,
  upper: Plane,
): [number, number] {
  const kl = V.dot(n, lower.normal);
  const ku = V.dot(n, upper.normal);
  const w = V.sub(V.scale(lower.normal, 1 / kl), V.scale(upper.normal, 1 / ku));
  const c =
    V.dot(upper.normal, upper.origin) / ku -
    V.dot(lower.normal, lower.origin) / kl;
  const size = V.norm(w);
  if (size < LINEAR_TOL) return [c, c];
  const [lo, hi] = along(pf.face, V.scale(w, 1 / size));
  return [c + size * lo, c + size * hi];
}

function between(
  f: ExtrudeFeature,
  s: Source,
  n: Vec3,
  [lower, upper]: [Plane, Plane | number],
  anchor: number,
): ToolResult {
  const base = tRange(s.pf, n, lower)[0] - TO_OBJECT_MARGIN;
  const end =
    typeof upper === "number"
      ? upper
      : tRange(s.pf, n, upper)[1] + TO_OBJECT_MARGIN;
  const prism = prismOf(f, s, n, end - base, base, anchor);
  return kernelCall("extrude from object", () => {
    const started = clipAtPlane(
      prism,
      lower.origin,
      lower.normal,
      f.id,
      "start",
    );
    return typeof upper === "number"
      ? started
      : clipAtPlane(started, upper.origin, V.scale(upper.normal, -1), f.id);
  });
}

export function evalEmboss(state: EvalState, f: EmbossFeature) {
  const pseudo: ExtrudeFeature = {
    id: f.id,
    name: f.name,
    suppressed: false,
    type: "extrude",
    profiles: f.profiles,
    distance: Math.abs(f.depth),
    direction: f.mode === "emboss" ? "normal" : "reverse",
    operation: f.mode === "emboss" ? "join" : "cut",
    ...(f.targets && { targets: f.targets }),
    ...(f.autoTargets && { autoTargets: f.autoTargets }),
  };
  return evalExtrude(state, pseudo);
}
