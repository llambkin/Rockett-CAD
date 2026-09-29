import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type ChamferFeature,
  type EdgeRef,
  type FilletFeature,
  type Vec3,
} from "@rockett/shared";
import {
  bboxOf,
  dir,
  edgeCentroid,
  edges as edgesOf,
  explore,
  faceCentroid,
  faces as facesOf,
  getKernel,
  kernelCall,
  lengthOf,
  listToArray,
  planarFacePlane,
  pnt,
  progress,
  release,
  scoped,
  shapeHash,
  shapeList,
  solids,
  transformOp,
  vec,
  vertices as verticesOf,
  wires as wiresOf,
  type Shape,
} from "./kernel.js";
import {
  computeEdgeNames,
  finalizeNames,
  propagateNames,
  type NameMap,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { V, frameFromPlane } from "./frames.js";
import { tangentEdges } from "./tangentEdges.js";
import {
  NoCorner,
  fuseNamed,
  registerBodySolids,
  rejectInvalid,
  unifyTool,
  vertexPoint,
  type EvalState,
  type ToolResult,
} from "./features.js";
function blendPerBody(
  state: EvalState,
  refs: EdgeRef[],
  blend: (body: NamedBody, refs: EdgeRef[]) => void,
): void {
  const groups = new Map<string, EdgeRef[]>();
  for (const ref of refs) {
    const group = groups.get(ref.bodyId);
    if (group) group.push(ref);
    else groups.set(ref.bodyId, [ref]);
  }
  const targets = [...groups].map(([bodyId, bodyRefs]) => {
    const body = state.bodies.get(bodyId);
    if (!body) throw new Error(`body ${bodyId} no longer exists`);
    return { body, bodyRefs };
  });
  for (const { body, bodyRefs } of targets) {
    try {
      blend(body, bodyRefs);
    } catch (error) {
      if (targets.length === 1) throw error;
      throw new Error(`${(error as Error).message} (body ${body.bodyId})`, {
        cause: error,
      });
    }
  }
}

function collectEdges(
  body: NamedBody,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  tangentChain: boolean | undefined,
): { edge: Shape; name: string }[] {
  const resolve = (ref: EdgeRef) => {
    const edge = byName.get(ref.edgeName);
    if (!edge) {
      throw new Error(`referenced edge no longer exists: ${ref.edgeName}`);
    }
    return { edge, name: ref.edgeName };
  };
  const seeds = refs.map(resolve);
  return tangentChain ? tangentEdges(body, refs).map(resolve) : seeds;
}

function blendNames(
  op: any,
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  featureId: string,
): NameMap {
  const k = getKernel();
  const provisional = new ShapeMap<string>();
  const bodyFaces = facesOf(body.shape);
  try {
    for (const face of bodyFaces) {
      const name = body.names.get(face);
      if (!name || op.IsDeleted(face)) continue;
      const modified = listToArray(op.Modified(face));
      for (const mf of modified.length > 0 ? modified : [face]) {
        provisional.set(mf, name);
      }
      release(modified);
    }
  } finally {
    release(bodyFaces);
  }
  sourceEdges.forEach((se, i) => {
    const gen = listToArray(op.Generated(se.edge));
    gen.forEach((g, j) => {
      if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
        provisional.set(
          g,
          `f:${featureId}:fe:${i + 1}${gen.length > 1 ? `:${j + 1}` : ""}`,
        );
      }
    });
    release(gen);
  });
  return finalizeNames(result, provisional, featureId);
}

export function evalFillet(state: EvalState, f: FilletFeature): void {
  if (f.edges.length === 0) throw new Error("no edges selected");
  if (f.radius <= 0) throw new Error("fillet radius must be positive");
  blendPerBody(state, f.edges, (body, refs) =>
    filletBody(state, f, body, refs),
  );
}

function filletBody(
  state: EvalState,
  f: FilletFeature,
  body: NamedBody,
  refs: EdgeRef[],
): void {
  const bodyId = body.bodyId;
  const k = getKernel();
  kernelCall("fillet", () => {
    const byName = computeEdgeNames(body).byName;
    const op = new k.BRepFilletAPI_MakeFillet(
      body.shape,
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    let result: Shape | undefined;
    try {
      const sourceEdges = collectEdges(body, byName, refs, f.tangentChain);
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge)) op.Add_2(f.radius, edge);
      }
      if (op.NbContours() === 0) {
        throw new NoCorner(
          `no sharp corner to fillet on ${sourceEdges.map((s) => s.name).join(", ")}: the faces meet smoothly there`,
        );
      }
      op.Build(progress());
      const spilled = op.IsDone() ? spilledEnds(op) : new Set<number>();
      const ends =
        !op.IsDone() || spilled.size > 0
          ? openEnds(op, sourceEdges, spilled)
          : [];
      const clipped =
        ends.length > 0 && filletClipped(body, sourceEdges, ends, f);
      if (clipped) {
        result = clipped.shape;
        registerBodySolids(state, bodyId, result, clipped.names);
        return;
      }
      if (!op.IsDone()) {
        throw new Error(filletFailure(op, byName, refs, f.radius));
      }
      result = op.Shape();
      rejectBadBlend(
        op,
        sourceEdges,
        result,
        body.shape,
        "fillet",
        `radius ${f.radius}`,
        "try fewer edges or a different radius",
      );
      const names = blendNames(op, body, sourceEdges, result, f.id);
      registerBodySolids(state, bodyId, result, names);
    } finally {
      result?.delete();
      op.delete();
      release(byName.values());
    }
  });
}

interface OpenEnd {
  at: Vec3;
  out: Vec3;
}

function outward(edge: Shape, vertex: Shape): OpenEnd {
  const k = getKernel();
  const at = vertexPoint(vertex);
  const curve = new k.BRepAdaptor_Curve_2(edge);
  const p = pnt(0, 0, 0);
  const d = vec(0, 0, 0);
  const [start, end] = [curve.FirstParameter(), curve.LastParameter()];
  curve.D1(start, p, d);
  const atStart = V.norm(V.sub([p.X(), p.Y(), p.Z()], at)) < LINEAR_TOL;
  curve.D1(atStart ? start : end, p, d);
  const along = V.normalize([d.X(), d.Y(), d.Z()]);
  release([curve, p, d]);
  return { at, out: atStart ? V.scale(along, -1) : along };
}

function capsEnd(face: Shape, end: OpenEnd): boolean {
  const k = getKernel();
  return scoped((own) => {
    const typed = own(k.TopoDS.Face_1(face));
    const surface = own(new k.BRepAdaptor_Surface_2(typed, true));
    const [u0, u1] = [surface.FirstUParameter(), surface.LastUParameter()];
    const [v0, v1] = [surface.FirstVParameter(), surface.LastVParameter()];
    const onPlane = (at: Vec3) =>
      Math.abs(V.dot(V.sub(at, end.at), end.out)) <= LINEAR_TOL;
    const samples = [0, 0.5, 1].flatMap((s) =>
      [0, 0.5, 1].map((t) => {
        const p = own(surface.Value(u0 + s * (u1 - u0), v0 + t * (v1 - v0)));
        return [p.X(), p.Y(), p.Z()] as Vec3;
      }),
    );
    return [faceCentroid(typed), ...samples].every(onPlane);
  });
}

function openEnds(
  op: any,
  sourceEdges: { edge: Shape }[],
  spilled: Set<number>,
): OpenEnd[] {
  const chosen = new Set(sourceEdges.map(({ edge }) => shapeHash(edge)));
  const touches = new Map<number, { vertex: Shape; edge: Shape }[]>();
  for (const { edge } of sourceEdges) {
    for (const vertex of verticesOf(edge)) {
      const hash = shapeHash(vertex);
      touches.set(hash, [...(touches.get(hash) ?? []), { vertex, edge }]);
    }
  }
  const continued = new Set<number>();
  for (let c = 1; c <= op.NbContours(); c++) {
    for (let e = 1; e <= op.NbEdges(c); e++) {
      const edge = op.Edge(c, e);
      if (!chosen.has(shapeHash(edge))) {
        const vertices = verticesOf(edge);
        for (const vertex of vertices) continued.add(shapeHash(vertex));
        release(vertices);
      }
      edge.delete();
    }
  }
  const ends = [...touches]
    .filter(
      ([hash, list]) =>
        list.length === 1 && (continued.has(hash) || spilled.has(hash)),
    )
    .map(([, [only]]) => outward(only!.edge, only!.vertex));
  for (const list of touches.values())
    release(list.map(({ vertex }) => vertex));
  return ends;
}

function splitAtEnds(
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  ends: OpenEnd[],
  featureId: string,
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const k = getKernel();
  const { min, max } = bboxOf(body.shape);
  const reach = 2 * V.norm(V.sub(max, min)) + 1;
  const beyond = ends
    .map((end) => {
      const { xAxis, yAxis, normal } = frameFromPlane(end.at, end.out);
      const corner = V.sub(end.at, V.scale(V.add(xAxis, yAxis), reach));
      const axes = own(
        new k.gp_Ax2_2(
          own(pnt(...corner)),
          own(dir(...normal)),
          own(dir(...xAxis)),
        ),
      );
      const box = own(
        new k.BRepPrimAPI_MakeBox_5(axes, 2 * reach, 2 * reach, reach),
      );
      return own(box.Shape());
    })
    .reduce((a, b) =>
      own(own(new k.BRepAlgoAPI_Fuse_3(a, b, progress())).Shape()),
    );
  const cut = own(new k.BRepAlgoAPI_Cut_3(body.shape, beyond, progress()));
  const common = own(
    new k.BRepAlgoAPI_Common_3(body.shape, beyond, progress()),
  );
  if (!cut.IsDone() || !common.IsDone()) return null;
  const kept = sourceEdges.map(({ edge }) => {
    const split = cut.IsDeleted(edge) ? [] : listToArray(cut.Modified(edge));
    const image = split.length === 1 ? own(k.TopoDS.Edge_1(split[0])) : edge;
    release(split);
    const whole = !cut.IsDeleted(edge) && split.length <= 1;
    return whole && Math.abs(lengthOf(image) - lengthOf(edge)) < LINEAR_TOL
      ? { edge: image }
      : null;
  });
  if (kept.some((image) => !image)) return null;
  const blank = { shape: beyond, names: new ShapeMap<string>() };
  const [piece, rest] = [cut, common].map((op) => {
    const shape = own(op.Shape());
    return {
      bodyId: body.bodyId,
      shape,
      names: propagateNames(op, [body, blank], shape, featureId),
    };
  });
  return { piece: piece!, rest: rest!, kept: kept as { edge: Shape }[] };
}

function filletClipped(
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  ends: OpenEnd[],
  f: FilletFeature,
): ToolResult | null {
  const k = getKernel();
  const size = `radius ${f.radius}`;
  const advice = "try fewer edges or a different radius";
  return scoped((own) => {
    const split = splitAtEnds(body, sourceEdges, ends, f.id, own);
    if (!split) return null;
    const { piece, rest, kept } = split;
    const op = own(
      new k.BRepFilletAPI_MakeFillet(
        piece.shape,
        k.ChFi3d_FilletShape.ChFi3d_Rational,
      ),
    );
    for (const { edge } of kept)
      if (!op.Contour(edge)) op.Add_2(f.radius, edge);
    op.Build(progress());
    if (!op.IsDone()) return null;
    const filleted = own(op.Shape());
    rejectBadBlend(op, kept, filleted, piece.shape, "fillet", size, advice);
    const joined = fuseNamed(
      { shape: filleted, names: blendNames(op, piece, kept, filleted, f.id) },
      rest,
      f.id,
      `fillet of ${size} could not close its ends: ${advice}; the previous body has been kept`,
    );
    const merged = unifyTool(joined, f.id);
    if (merged !== joined) own(joined.shape);
    try {
      rejectBadBlend(
        null,
        [],
        merged.shape,
        body.shape,
        "fillet",
        size,
        advice,
      );
    } catch (error) {
      merged.shape.delete();
      throw error;
    }
    return merged;
  });
}

function filletFailure(
  op: any,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  radius: number,
): string {
  const chosen = new Set(refs.map((r) => shapeHash(byName.get(r.edgeName)!)));
  const names = new Map(
    [...byName].map(([name, edge]) => [shapeHash(edge), name]),
  );
  const added = new Set<string>();
  for (let i = 1; i <= op.NbFaultyContours(); i++) {
    const contour = op.FaultyContour(i);
    for (let j = 1; j <= op.NbEdges(contour); j++) {
      const edge = op.Edge(contour, j);
      const hash = shapeHash(edge);
      edge.delete();
      if (!chosen.has(hash)) added.add(names.get(hash) ?? "an unnamed edge");
    }
  }
  return added.size > 0
    ? `fillet of radius ${radius} failed on ${[...added].join(", ")}, a tangent continuation of the selected edges: try a smaller radius or fillet this edge before its neighbours`
    : `fillet of radius ${radius} failed: radius may be too large for the geometry`;
}

function rejectBadBlend(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  before: Shape,
  kind: "fillet" | "chamfer",
  size: string,
  advice: string,
): void {
  rejectInvalid(result, before, kind, size, advice);
  if (op && looseBlend(op, sourceEdges, result))
    throw new Error(
      `${kind} could not be built cleanly at this ${kind === "fillet" ? "radius" : "distance"}; try a smaller one`,
    );
  if (op && spilledEnds(op).size > 0)
    throw new Error(
      `${kind} of ${size} runs past the end of its edges: ${advice}; the previous body has been kept`,
    );
  const cut = cutsThrough(op, sourceEdges, result, before);
  if (cut === false) return;
  throw new Error(
    cut
      ? `${kind} of ${size} cuts through the body: ${advice}; the previous body has been kept`
      : `${kind} of ${size} could not be checked for cutting through the body: ${advice}; the previous body has been kept`,
  );
}

function spilledEnds(op: any): Set<number> {
  const touches = new Map<number, number>();
  const ends: { vertex: Shape; edge: Shape }[] = [];
  for (let c = 1; c <= op.NbContours(); c++) {
    if (!op.Closed(c))
      ends.push(
        { vertex: op.FirstVertex(c), edge: op.Edge(c, 1) },
        { vertex: op.LastVertex(c), edge: op.Edge(c, op.NbEdges(c)) },
      );
    for (let e = 1; e <= op.NbEdges(c); e++) {
      const edge = op.Edge(c, e);
      const vertices = verticesOf(edge);
      for (const vertex of vertices) {
        const hash = shapeHash(vertex);
        touches.set(hash, (touches.get(hash) ?? 0) + 1);
      }
      release([edge, ...vertices]);
    }
  }
  const spilled = new Set<number>();
  for (const { vertex, edge } of ends) {
    const hash = shapeHash(vertex);
    if (touches.get(hash) !== 1) continue;
    const generated = listToArray(op.Generated(vertex));
    const end = generated.length > 0 ? outward(edge, vertex) : null;
    if (end && !generated.every((face) => capsEnd(face, end)))
      spilled.add(hash);
    release(generated);
  }
  release(ends.flatMap(({ vertex, edge }) => [vertex, edge]));
  return spilled;
}

function chamferByEnvelope(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  distance: number,
  featureId: string,
): ToolResult | null {
  let current: NamedBody = body;
  let built = false;
  try {
    built = scoped((own) => {
      const k = getKernel();
      const selHashes = new Set(selected.map((s) => shapeHash(s.edge)));
      const bodyFaces = facesOf(body.shape).map(own);
      const edgeFaces = new Map<number, Shape[]>();
      for (const face of bodyFaces) {
        for (const e of edgesOf(face).map(own)) {
          const h = shapeHash(e);
          edgeFaces.set(h, [...(edgeFaces.get(h) ?? []), face]);
        }
      }
      const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

      const caps: {
        face: Shape;
        edges: Shape[];
        plane: { origin: Vec3; normal: Vec3 };
      }[] = [];
      const covered = new Set<number>();
      for (const face of bodyFaces) {
        const fe = edgesOf(own(k.BRepTools.OuterWire(face))).map(own);
        if (fe.length === 0 || !fe.every((e) => selHashes.has(shapeHash(e))))
          continue;
        const plane = planarFacePlane(face);
        if (!plane) return false;
        for (const e of fe) {
          const h = shapeHash(e);
          const wall = (edgeFaces.get(h) ?? []).find(
            (w) => shapeHash(w) !== shapeHash(face),
          );
          const wp = wall ? planarFacePlane(wall) : null;
          if (
            !wall ||
            !wp ||
            Math.abs(dot(wp.normal, plane.normal)) > UNIT_DOT_TOL
          )
            return false;
          let wallDepth = 0;
          for (const v of verticesOf(wall).map(own)) {
            const p = vertexPoint(v);
            const rel: Vec3 = [
              p[0] - plane.origin[0],
              p[1] - plane.origin[1],
              p[2] - plane.origin[2],
            ];
            wallDepth = Math.max(wallDepth, -dot(rel, plane.normal));
          }
          if (wallDepth < distance - LINEAR_TOL) return false;
          covered.add(h);
        }
        caps.push({ face, edges: fe, plane });
      }
      if (caps.length === 0 || covered.size !== selHashes.size) return false;

      const inward = (shape: Shape, n: Vec3, t: number): Shape => {
        const tr = own(new k.gp_Trsf_1());
        tr.SetTranslation_1(own(vec(-n[0] * t, -n[1] * t, -n[2] * t)));
        return own(own(transformOp(shape, tr)).Shape());
      };
      const bb = bboxOf(body.shape);
      const diag = Math.hypot(
        bb.max[0] - bb.min[0],
        bb.max[1] - bb.min[1],
        bb.max[2] - bb.min[2],
      );

      for (const cap of caps) {
        const n = cap.plane.normal;
        const outlineFaceMk = own(
          new k.BRepBuilderAPI_MakeFace_15(
            own(k.BRepTools.OuterWire(cap.face)),
            true,
          ),
        );
        if (!outlineFaceMk.IsDone()) return false;
        const outlineFace = own(outlineFaceMk.Face());
        const offsetOutline = (d: number): Shape | undefined => {
          const mk = own(
            new k.BRepOffsetAPI_MakeOffset_2(
              outlineFace,
              k.GeomAbs_JoinType.GeomAbs_Intersection,
              false,
            ),
          );
          mk.Perform(d, 0);
          return mk.IsDone() ? wiresOf(own(mk.Shape())).map(own)[0] : undefined;
        };
        const inner = offsetOutline(-distance);
        if (!inner) return false;
        const innerPts = verticesOf(inner).map(own).map(vertexPoint);
        const nearestInner = (q: Vec3): Vec3 | undefined => {
          let best = innerPts[0];
          let bestDist = Infinity;
          for (const c of innerPts) {
            const dist = Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]);
            if (dist < bestDist) {
              bestDist = dist;
              best = c;
            }
          }
          return best;
        };
        const deeper = (p: Vec3): Vec3 => [
          p[0] - n[0] * distance,
          p[1] - n[1] * distance,
          p[2] - n[2] * distance,
        ];
        const sewing = own(
          new k.BRepBuilderAPI_Sewing(LINEAR_TOL, true, true, true, false),
        );
        const addFace = (wire: Shape): boolean => {
          const mk = own(
            new k.BRepBuilderAPI_MakeFace_15(own(k.TopoDS.Wire_1(wire)), true),
          );
          const ok = mk.IsDone();
          if (ok) sewing.Add(own(mk.Face()));
          return ok;
        };
        for (const e of cap.edges) {
          const ends = verticesOf(e).map(own).map(vertexPoint);
          if (ends.length !== 2) return false;
          const q1 = nearestInner(ends[0]!);
          const q2 = nearestInner(ends[1]!);
          if (!q1 || !q2 || q1 === q2) return false;
          const poly = own(new k.BRepBuilderAPI_MakePolygon_1());
          for (const p of [deeper(ends[0]!), deeper(ends[1]!), q2, q1]) {
            poly.Add_1(own(pnt(p[0], p[1], p[2])));
          }
          poly.Close();
          if (!poly.IsDone() || !addFace(own(poly.Wire()))) return false;
        }
        if (!addFace(inner)) return false;
        if (!addFace(inward(own(k.BRepTools.OuterWire(cap.face)), n, distance)))
          return false;
        sewing.Perform(progress());
        const shell = own(sewing.SewedShape());
        if (shell.ShapeType() !== k.TopAbs_ShapeEnum.TopAbs_SHELL) return false;
        const solidMk = own(
          new k.BRepBuilderAPI_MakeSolid_3(own(k.TopoDS.Shell_1(shell))),
        );
        const band: Shape = own(solidMk.Solid());
        k.BRepLib.OrientClosedSolid(band);
        const bigWire = offsetOutline(diag);
        if (!bigWire) return false;
        const bigFace = own(
          new k.BRepBuilderAPI_MakeFace_15(
            own(k.TopoDS.Wire_1(inward(bigWire, n, distance))),
            true,
          ),
        );
        const far = diag + 1;
        const prism = own(
          new k.BRepPrimAPI_MakePrism_1(
            own(bigFace.Face()),
            own(vec(-n[0] * far, -n[1] * far, -n[2] * far)),
            false,
            true,
          ),
        );
        prism.Build(progress());
        const fuse = own(
          new k.BRepAlgoAPI_Fuse_3(band, own(prism.Shape()), progress()),
        );
        fuse.Build(progress());
        if (!fuse.IsDone()) return false;
        const envelope = own(fuse.Shape());

        const envNames = new ShapeMap<string>();
        const capName = current.names.get(cap.face);
        const mids = cap.edges.map((e) => ({ e, c: edgeCentroid(e) }));
        for (const face of facesOf(envelope).map(own)) {
          const c = faceCentroid(face);
          const depth = -dot(
            [
              c[0] - cap.plane.origin[0],
              c[1] - cap.plane.origin[1],
              c[2] - cap.plane.origin[2],
            ],
            n,
          );
          if (Math.abs(depth) < LINEAR_TOL) {
            if (capName) envNames.set(face, capName);
            continue;
          }
          if (depth < LINEAR_TOL || depth > distance - LINEAR_TOL) continue;
          let best = -1;
          let bestDist = Infinity;
          mids.forEach((m, i) => {
            const dist = Math.hypot(
              c[0] - m.c[0],
              c[1] - m.c[1],
              c[2] - m.c[2],
            );
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          });
          if (best < 0) continue;
          const idx = selected.findIndex(
            (s) => shapeHash(s.edge) === shapeHash(mids[best]!.e),
          );
          envNames.set(face, `f:${featureId}:fe:${idx + 1}`);
        }

        const common = own(
          new k.BRepAlgoAPI_Common_3(current.shape, envelope, progress()),
        );
        common.Build(progress());
        if (!common.IsDone()) return false;
        const result = common.Shape();
        if (solids(result).map(own).length === 0) {
          result.delete();
          return false;
        }
        const names = propagateNames(
          common,
          [current, { shape: envelope, names: envNames }],
          result,
          featureId,
        );
        if (current !== body) own(current.shape);
        current = { bodyId: body.bodyId, shape: result, names };
      }
      return true;
    });
    return built ? { shape: current.shape, names: current.names } : null;
  } finally {
    if (!built && current !== body) current.shape.delete();
  }
}

export function evalChamfer(state: EvalState, f: ChamferFeature): void {
  if (f.edges.length === 0) throw new Error("no edges selected");
  if (f.distance <= 0) throw new Error("chamfer distance must be positive");
  blendPerBody(state, f.edges, (body, refs) =>
    chamferBody(state, f, body, refs),
  );
}

function chamferBody(
  state: EvalState,
  f: ChamferFeature,
  body: NamedBody,
  refs: EdgeRef[],
): void {
  const bodyId = body.bodyId;
  const k = getKernel();
  kernelCall("chamfer", () => {
    const byName = computeEdgeNames(body).byName;
    const op = new k.BRepFilletAPI_MakeChamfer(body.shape);
    let result: Shape | undefined;
    try {
      const sourceEdges = collectEdges(body, byName, refs, f.tangentChain);
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge)) op.Add_2(f.distance, edge);
      }
      op.Build(progress());
      const size = `distance ${f.distance}`;
      const advice = "try fewer edges or a different distance";
      if (!op.IsDone()) {
        const viaEnvelope = chamferByEnvelope(
          body,
          sourceEdges,
          f.distance,
          f.id,
        );
        if (!viaEnvelope) {
          throw new Error(
            `could not build a ${f.distance} mm chamfer: check for missing connecting edges or try a smaller distance`,
          );
        }
        result = viaEnvelope.shape;
        rejectBadBlend(
          null,
          sourceEdges,
          result,
          body.shape,
          "chamfer",
          size,
          advice,
        );
        registerBodySolids(state, bodyId, result, viaEnvelope.names);
        return;
      }
      result = op.Shape();
      rejectBadBlend(
        op,
        sourceEdges,
        result,
        body.shape,
        "chamfer",
        size,
        advice,
      );
      const names = blendNames(op, body, sourceEdges, result, f.id);
      registerBodySolids(state, bodyId, result, names);
    } finally {
      result?.delete();
      op.delete();
      release(byName.values());
    }
  });
}

const CONTACT = 0.01;
const LOOSE = 1e-3;

interface Patch {
  face: Shape;
  edges: Set<number>;
  tolerance: number;
  box: any;
}

function shellCount(shape: Shape): number {
  const shells = [...explore(shape, "shell")];
  release(shells);
  return shells.length;
}

function generatedBy(op: any, sourceEdges: { edge: Shape }[]): Set<number> {
  const made = new Set<number>();
  for (const { edge } of sourceEdges) {
    const ends = verticesOf(edge);
    for (const from of [edge, ...ends]) {
      const generated = listToArray(op.Generated(from));
      for (const shape of generated) made.add(shapeHash(shape));
      release(generated);
    }
    release(ends);
  }
  return made;
}

function toleranceOf(face: Shape): number {
  const k = getKernel();
  return Math.max(
    ...["VERTEX", "EDGE", "FACE"].map((type) =>
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum[`TopAbs_${type}`]),
    ),
  );
}

function looseBlend(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
): boolean {
  const made = generatedBy(op, sourceEdges);
  const all = facesOf(result);
  const loose = all.some(
    (face) => made.has(shapeHash(face)) && toleranceOf(face) > LOOSE,
  );
  release(all);
  return loose;
}

function patch(face: Shape, box: any): Patch {
  const k = getKernel();
  const tolerance = toleranceOf(face);
  if (tolerance > CONTACT) k.BRepBndLib.AddOptimal(face, box, false, false);
  else k.BRepBndLib.Add(face, box, true);
  box.Enlarge(CONTACT);
  const around = edgesOf(face);
  const hashes = new Set(around.map(shapeHash));
  release(around);
  return { face, edges: hashes, tolerance, box };
}

function sharesEdge(a: Patch, b: Patch): boolean {
  return [...a.edges].some((edge) => b.edges.has(edge));
}

function near(a: Patch, b: Patch): boolean {
  if (a.box.IsOut_4(b.box)) return false;
  if (a.tolerance + b.tolerance <= CONTACT) return true;
  const k = getKernel();
  return scoped((own) => {
    const dist = own(
      new k.BRepExtrema_DistShapeShape_2(
        a.face,
        b.face,
        k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
        k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
        progress(),
      ),
    );
    return !dist.IsDone() || dist.Value() <= CONTACT;
  });
}

function crosses(face: Shape, others: Shape[]): boolean | null {
  const k = getKernel();
  return scoped((own) => {
    const builder = own(new k.BRep_Builder());
    const rest = own(new k.TopoDS_Compound());
    builder.MakeCompound(rest);
    for (const other of others) builder.Add(rest, other);
    const fuse = own(new k.BRepAlgoAPI_BuilderAlgo_1());
    fuse.SetArguments(own(shapeList([face, rest])));
    fuse.SetNonDestructive(true);
    fuse.Build(progress());
    if (fuse.HasErrors()) return null;
    return !own(fuse.SectionEdges()).IsEmpty();
  });
}

export function cutsThrough(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  before: Shape,
): boolean | null {
  if (shellCount(result) !== shellCount(before)) return true;
  if (!op) return false;
  const made = generatedBy(op, sourceEdges);
  const k = getKernel();
  return scoped((own) => {
    const all = facesOf(result).map((face) =>
      patch(own(face), own(new k.Bnd_Box_1())),
    );
    const blend = all.filter((p) => made.has(shapeHash(p.face)));
    const rest = all.filter(
      (p) =>
        !made.has(shapeHash(p.face)) && !blend.some((b) => sharesEdge(p, b)),
    );
    for (const [n, a] of blend.entries()) {
      const partners = [...blend.slice(n + 1), ...rest].filter(
        (b) => !sharesEdge(a, b) && near(a, b),
      );
      if (partners.length === 0) continue;
      const verdict = crosses(
        a.face,
        partners.map((b) => b.face),
      );
      if (verdict !== false) return verdict;
    }
    return false;
  });
}
