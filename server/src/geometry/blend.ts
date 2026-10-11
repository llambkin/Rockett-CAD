import { nativeFillet } from "./nativeFillet.js";
import { moduleFillet } from "./filletRoute.js";
import { planarChamfer } from "./planarChamfer.js";
import { addChamferContour } from "./chamferContour.js";
import { blendNames } from "./blendNaming.js";
import { rejectBadBlend } from "./blendValidity.js";
export { cutsThrough } from "./blendValidity.js";
import { fuseOperation, commonOperation } from "./boolean.js";
import { V } from "./frames.js";
import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type ChamferFeature,
  type EdgeRef,
  type FilletFeature,
  type Vec3,
  filletSets,
} from "@rockett/shared";
import {
  bboxOf,
  diagonal,
  acquire,
  edgeCentroid,
  edges as edgesOf,
  faceCentroid,
  faces as facesOf,
  getKernel,
  kernelCall,
  planarFacePlane,
  pnt,
  progress,
  scoped,
  solids,
  transformOp,
  vec,
  vertices as verticesOf,
  wires as wiresOf,
  type Shape,
} from "./kernel.js";
import {
  blendFaceName,
  computeEdgeNames,
  propagateNames,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { tangentEdges } from "./tangentEdges.js";
import { blendEdges } from "./blendEdges.js";
import {
  registerBodySolids,
  vertexPoint,
  type EvalState,
  type ToolResult,
} from "./featureState.js";
function blendPerBody<R extends EdgeRef>(
  state: EvalState,
  refs: R[],
  blend: (body: NamedBody, refs: R[]) => void,
): void {
  const groups = new Map<string, R[]>();
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
      const failure = new Error((error as Error).message, { cause: error });
      throw Object.assign(failure, { bodyId: body.bodyId });
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

type SizedRef = EdgeRef & { radius: number };

function filletRefs(state: EvalState, f: FilletFeature): SizedRef[] {
  const seen = new Set<string>();
  return filletSets(f).flatMap((set) =>
    blendEdges(state, { type: "fillet", ...set })
      .filter(({ bodyId, edgeName }) => {
        const key = `${bodyId}\n${edgeName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((ref) => ({ ...ref, radius: set.radius })),
  );
}

export function evalFillet(state: EvalState, f: FilletFeature): void {
  if (filletSets(f).some((set) => set.radius <= 0))
    throw new Error("fillet radius must be positive");
  const refs = filletRefs(state, f);
  const radii = [...new Set(refs.map((ref) => ref.radius))];
  blendPerBody(state, refs, (body, bodyRefs) =>
    radii.length === 1
      ? filletBody(state, { ...f, radius: radii[0]! }, body, bodyRefs)
      : mixedFillet(state, f, radii, body, bodyRefs),
  );
}

function filletBody(
  state: EvalState,
  f: FilletFeature,
  body: NamedBody,
  refs: EdgeRef[],
): void {
  kernelCall("fillet", () => {
    const byName = computeEdgeNames(body).byName;
    const sourceEdges = collectEdges(body, byName, refs, f.tangentChain);
    const result =
      moduleFillet(body, sourceEdges, f, byName, refs) ??
      nativeFillet(body, sourceEdges, byName, refs, f);
    registerBodySolids(state, body.bodyId, result.shape, result.names);
  });
}

function mixedFillet(
  state: EvalState,
  f: FilletFeature,
  radii: number[],
  body: NamedBody,
  refs: SizedRef[],
): void {
  kernelCall("fillet", () => {
    const byName = computeEdgeNames(body).byName;
    const seen = new Set<string>();
    const sourceEdges = radii.flatMap((radius) =>
      collectEdges(
        body,
        byName,
        refs.filter((ref) => ref.radius === radius),
        f.tangentChain,
      )
        .filter(({ name }) => !seen.has(name) && !!seen.add(name))
        .map((edge) => ({ ...edge, radius })),
    );
    const result = nativeFillet(body, sourceEdges, byName, refs, f);
    registerBodySolids(state, body.bodyId, result.shape, result.names);
  });
}

function chamferByEnvelope(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  distance: number,
  featureId: string,
): ToolResult | null {
  let current: NamedBody = body;
  const built = scoped((own) => {
    const k = getKernel();
    const chosen = selected
      .map(({ edge }) => edge)
      .filter((edge, i, all) => !all.slice(0, i).some((e) => e.IsSame(edge)));
    const bodyFaces = facesOf(body.shape).map(own);
    const edgeFaces = bodyFaces.map((face) => ({
      face,
      edges: edgesOf(face).map(own),
    }));
    const caps: {
      face: Shape;
      edges: Shape[];
      plane: { origin: Vec3; normal: Vec3 };
    }[] = [];
    const covered = new Set<number>();
    for (const face of bodyFaces) {
      const fe = edgesOf(own(k.BRepTools.OuterWire(face))).map(own);
      if (fe.length === 0 || !fe.every((e) => chosen.some((s) => s.IsSame(e))))
        continue;
      const plane = planarFacePlane(face);
      if (!plane) return false;
      for (const e of fe) {
        const wall = edgeFaces.find(
          (w) => !w.face.IsSame(face) && w.edges.some((edge) => edge.IsSame(e)),
        )?.face;
        const wp = wall ? planarFacePlane(wall) : null;
        if (
          !wall ||
          !wp ||
          Math.abs(V.dot(wp.normal, plane.normal)) > UNIT_DOT_TOL
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
          wallDepth = Math.max(wallDepth, -V.dot(rel, plane.normal));
        }
        if (wallDepth < distance - LINEAR_TOL) return false;
        covered.add(chosen.findIndex((s) => s.IsSame(e)));
      }
      caps.push({ face, edges: fe, plane });
    }
    if (caps.length === 0 || covered.size !== chosen.length) return false;

    const inward = (shape: Shape, n: Vec3, t: number): Shape => {
      const tr = own(new k.gp_Trsf_1());
      tr.SetTranslation_1(own(vec(-n[0] * t, -n[1] * t, -n[2] * t)));
      return own(own(transformOp(shape, tr)).Shape());
    };
    const diag = diagonal(bboxOf(body.shape));

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
      const fuse = own(fuseOperation(band, own(prism.Shape())));
      fuse.Build(progress());
      if (!fuse.IsDone()) return false;
      const envelope = own(fuse.Shape());

      const envNames = new ShapeMap<string>();
      const capName = current.names.get(cap.face);
      const mids = cap.edges.map((e) => ({ e, c: edgeCentroid(e) }));
      for (const face of facesOf(envelope).map(own)) {
        const c = faceCentroid(face);
        const depth = -V.dot(
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
          const dist = Math.hypot(c[0] - m.c[0], c[1] - m.c[1], c[2] - m.c[2]);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        });
        if (best < 0) continue;
        const idx = selected.findIndex((s) => s.edge.IsSame(mids[best]!.e));
        envNames.set(face, blendFaceName(featureId, idx));
      }

      const common = own(commonOperation(current.shape, envelope));
      common.Build(progress());
      if (!common.IsDone()) return false;
      const result = own(common.Shape());
      if (solids(result).map(own).length === 0) {
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
    if (current !== body) own.keep(current.shape);
    return true;
  });
  if (built) acquire(current.shape);
  return built ? { shape: current.shape, names: current.names } : null;
}

export function evalChamfer(state: EvalState, f: ChamferFeature): void {
  if (f.distance <= 0) throw new Error("chamfer distance must be positive");
  blendPerBody(state, blendEdges(state, f), (body, refs) =>
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
    const sourceEdges = collectEdges(body, byName, refs, f.tangentChain);
    const equal = f.chamferType === "equalDistance";
    const planar =
      equal && planarChamfer(body, sourceEdges, f.distance, f.id, byName, refs);
    if (planar) {
      registerBodySolids(state, bodyId, planar.shape, planar.names);
      return;
    }
    const op = acquire(new k.BRepFilletAPI_MakeChamfer(body.shape));
    let result: Shape | undefined;
    {
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge))
          addChamferContour(op, body, edge, sourceEdges, f);
      }
      op.Build(progress());
      const size = `distance ${f.distance}`;
      const advice = "try fewer edges or a different distance";
      if (!op.IsDone()) {
        const viaEnvelope =
          equal && chamferByEnvelope(body, sourceEdges, f.distance, f.id);
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
      result = acquire(op.Shape());
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
    }
  });
}
