/**
 * Solved sketch → OCCT B-Rep profile faces.
 *
 * Takes solved sketch entities (from the shared constraint solver), the
 * detected profile regions (shared/profiles.ts), and the sketch plane frame,
 * and produces planar TopoDS_Face objects with an edge → sketch-entity map
 * used for persistent side-face naming during extrude/revolve.
 */

import type { PlaneFrame, Profile, SketchEntity, Vec3 } from "@rockett/shared";
import { arcAngles } from "@rockett/shared";
import {
  getKernel,
  kernelCall,
  pnt,
  dir,
  progress,
  shapeHash,
  type Shape,
} from "./kernel.js";
import { uvTo3d } from "./frames.js";

export interface ProfileFace {
  face: Shape; // TopoDS_Face
  /** edge hash → sketch entity id, for naming generated side faces */
  edgeEntity: Map<number, string>;
  profileId: string;
}

interface EntityMaps {
  points: Map<string, { x: number; y: number }>;
  lines: Map<string, { p1: string; p2: string }>;
  circles: Map<string, { center: string; radius: number }>;
  arcs: Map<string, { center: string; start: string; end: string }>;
}

function buildMaps(entities: SketchEntity[]): EntityMaps {
  const points = new Map<string, { x: number; y: number }>();
  const lines = new Map<string, { p1: string; p2: string }>();
  const circles = new Map<string, { center: string; radius: number }>();
  const arcs = new Map<
    string,
    { center: string; start: string; end: string }
  >();
  for (const e of entities) {
    if (e.kind === "point") points.set(e.id, { x: e.x, y: e.y });
    else if (e.kind === "line") lines.set(e.id, { p1: e.p1, p2: e.p2 });
    else if (e.kind === "circle")
      circles.set(e.id, { center: e.center, radius: e.radius });
    else if (e.kind === "arc")
      arcs.set(e.id, { center: e.center, start: e.start, end: e.end });
  }
  return { points, lines, circles, arcs };
}

/** Snap sketch endpoints that nearly coincide so OCCT wires connect exactly. */
function snapper(): (x: number, y: number) => [number, number] {
  const known: [number, number][] = [];
  return (x, y) => {
    for (const k of known) {
      if (Math.hypot(k[0] - x, k[1] - y) < 1e-6) return k;
    }
    const p: [number, number] = [x, y];
    known.push(p);
    return p;
  };
}

export function arcEdge(
  frame: PlaneFrame,
  c: { x: number; y: number },
  s: [number, number],
  e: [number, number],
  reversed = false,
): Shape {
  const k = getKernel();
  const { a0, a1, r } = arcAngles({
    cx: c.x,
    cy: c.y,
    sx: s[0],
    sy: s[1],
    ex: e[0],
    ey: e[1],
  });
  const amid = (a0 + a1) / 2;
  const [from, to] = reversed ? [e, s] : [s, e];
  const p1 = uvTo3d(frame, from[0], from[1]);
  const pm = uvTo3d(frame, c.x + r * Math.cos(amid), c.y + r * Math.sin(amid));
  const p2 = uvTo3d(frame, to[0], to[1]);
  const arcMk = new k.GC_MakeArcOfCircle_4(
    pnt(p1[0], p1[1], p1[2]),
    pnt(pm[0], pm[1], pm[2]),
    pnt(p2[0], p2[1], p2[2]),
  );
  const curveHandle = arcMk.Value();
  const baseHandle = new k.Handle_Geom_Curve_2(curveHandle.get());
  const mk = new k.BRepBuilderAPI_MakeEdge_24(baseHandle);
  const edge = mk.Edge();
  mk.delete();
  baseHandle.delete();
  curveHandle.delete();
  arcMk.delete();
  return edge;
}

/**
 * Build one wire from an oriented curve chain.
 * Returns the wire plus edge-hash → entity-id entries appended to edgeEntity.
 */
function buildWire(
  chain: {
    entityId: string;
    reversed: boolean;
    trim?: [number, number, number, number];
  }[],
  maps: EntityMaps,
  frame: PlaneFrame,
  snap: (x: number, y: number) => [number, number],
  edgeEntity: Map<number, string>,
): Shape {
  const k = getKernel();
  const wireMaker = new k.BRepBuilderAPI_MakeWire_1();

  const to3d = (uv: [number, number]): Vec3 => uvTo3d(frame, uv[0], uv[1]);

  for (const oc of chain) {
    let edge: Shape | null = null;
    const line = maps.lines.get(oc.entityId);
    const arc = maps.arcs.get(oc.entityId);
    const circle = maps.circles.get(oc.entityId);
    if (line) {
      // T-junction split pieces carry their own endpoints
      const a = oc.trim
        ? { x: oc.trim[0], y: oc.trim[1] }
        : maps.points.get(line.p1)!;
      const b = oc.trim
        ? { x: oc.trim[2], y: oc.trim[3] }
        : maps.points.get(line.p2)!;
      let s = snap(a.x, a.y);
      let e = snap(b.x, b.y);
      if (oc.reversed) [s, e] = [e, s];
      const p1 = to3d(s);
      const p2 = to3d(e);
      const mk = new k.BRepBuilderAPI_MakeEdge_3(
        pnt(p1[0], p1[1], p1[2]),
        pnt(p2[0], p2[1], p2[2]),
      );
      edge = mk.Edge();
      mk.delete();
    } else if (arc || (circle && oc.trim)) {
      // arcs, and pieces of a circle split by crossings (trim = CCW start/end)
      const c = maps.points.get(arc ? arc.center : circle!.center)!;
      // T-junction / crossing split pieces carry their own endpoints
      const s0 = oc.trim
        ? { x: oc.trim[0], y: oc.trim[1] }
        : maps.points.get(arc!.start)!;
      const e0 = oc.trim
        ? { x: oc.trim[2], y: oc.trim[3] }
        : maps.points.get(arc!.end)!;
      edge = arcEdge(frame, c, snap(s0.x, s0.y), snap(e0.x, e0.y), oc.reversed);
    } else if (circle) {
      const c = maps.points.get(circle.center)!;
      const c3 = to3d([c.x, c.y]);
      const ax2 = new k.gp_Ax2_2(
        pnt(c3[0], c3[1], c3[2]),
        dir(frame.normal[0], frame.normal[1], frame.normal[2]),
        dir(frame.xAxis[0], frame.xAxis[1], frame.xAxis[2]),
      );
      const circ = new k.gp_Circ_2(ax2, circle.radius);
      const mk = new k.BRepBuilderAPI_MakeEdge_8(circ);
      edge = mk.Edge();
      mk.delete();
      circ.delete();
      ax2.delete();
    }
    if (!edge)
      throw new Error(`profile references unknown entity ${oc.entityId}`);
    edgeEntity.set(shapeHash(edge), oc.entityId);
    wireMaker.Add_1(edge);
    if (!wireMaker.IsDone()) {
      wireMaker.delete();
      throw new Error(
        `failed to connect profile wire at entity ${oc.entityId}`,
      );
    }
  }
  const wire = wireMaker.Wire();
  wireMaker.delete();
  return wire;
}

/**
 * Match each edge of the final face back to the sketch entity it came from,
 * by geometry (wire building can rebuild edge shapes, so hashes from
 * construction time are unreliable).
 */
function matchEdgesToEntities(
  face: Shape,
  chainIds: string[],
  maps: EntityMaps,
  frame: PlaneFrame,
): Map<number, string> {
  const k = getKernel();
  const result = new Map<number, string>();
  const origin = frame.origin;
  const toUV = (p: {
    X(): number;
    Y(): number;
    Z(): number;
  }): [number, number] => {
    const dx = p.X() - origin[0];
    const dy = p.Y() - origin[1];
    const dz = p.Z() - origin[2];
    return [
      dx * frame.xAxis[0] + dy * frame.xAxis[1] + dz * frame.xAxis[2],
      dx * frame.yAxis[0] + dy * frame.yAxis[1] + dz * frame.yAxis[2],
    ];
  };
  const ex = new k.TopExp_Explorer_2(
    face,
    k.TopAbs_ShapeEnum.TopAbs_EDGE,
    k.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (ex.More()) {
    const edge = k.TopoDS.Edge_1(ex.Current());
    const curve = new k.BRepAdaptor_Curve_2(edge);
    const tMid = (curve.FirstParameter() + curve.LastParameter()) / 2;
    const mid3d = curve.Value(tMid);
    const [u, v] = toUV(mid3d);
    mid3d.delete();
    curve.delete();

    let best: { id: string; d: number } | null = null;
    for (const id of chainIds) {
      const line = maps.lines.get(id);
      const circle = maps.circles.get(id);
      const arc = maps.arcs.get(id);
      let d = Infinity;
      if (line) {
        const a = maps.points.get(line.p1)!;
        const b = maps.points.get(line.p2)!;
        const abx = b.x - a.x,
          aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        let t = ((u - a.x) * abx + (v - a.y) * aby) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(u - (a.x + t * abx), v - (a.y + t * aby));
      } else if (circle) {
        const c = maps.points.get(circle.center)!;
        d = Math.abs(Math.hypot(u - c.x, v - c.y) - circle.radius);
      } else if (arc) {
        const c = maps.points.get(arc.center)!;
        const s = maps.points.get(arc.start)!;
        const r = Math.hypot(s.x - c.x, s.y - c.y);
        d = Math.abs(Math.hypot(u - c.x, v - c.y) - r);
      }
      if (best === null || d < best.d) best = { id, d };
    }
    if (best && best.d < 1e-4) {
      result.set(shapeHash(edge), best.id);
    }
    ex.Next();
  }
  ex.delete();
  return result;
}

/** Minimal evaluated-sketch shape needed for face-region subtraction. */
export interface SketchOnPlane {
  frame: PlaneFrame;
  entities: SketchEntity[];
  profiles: Profile[];
}

/**
 * Fusion-style face splitting for direct face extrudes: closed regions of
 * sketches drawn on (coplanar with) a planar body face are subtracted from
 * it, so a circle sketched on a face extrudes as a hole unless its own
 * region is also extruded.
 *
 * Only regions that lie STRICTLY inside the face are subtracted (every
 * boundary sample must classify as interior) — a sketch region that equals
 * or crosses the face boundary leaves the face untouched. Any kernel
 * failure falls back to the unmodified face.
 */
export function subtractSketchRegionsFromFace(
  face: Shape,
  sketches: Iterable<SketchOnPlane>,
): { face: Shape; edgeEntity: Map<number, string> } {
  const noop = { face, edgeEntity: new Map<number, string>() };
  try {
    const k = getKernel();
    const faceT = k.TopoDS.Face_1(face);

    // Plane of the target face.
    const surf = new k.BRepAdaptor_Surface_2(faceT, false);
    if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Plane) {
      surf.delete();
      return noop;
    }
    const pln = surf.Plane();
    const loc = pln.Location();
    const axd = pln.Axis().Direction();
    const fp: Vec3 = [loc.X(), loc.Y(), loc.Z()];
    const fn: Vec3 = [axd.X(), axd.Y(), axd.Z()];
    surf.delete();

    // Sample points of a profile's outer polygon (flat [u,v,...]).
    const samples = (polygon: number[]): [number, number][] => {
      const n = polygon.length / 2;
      const out: [number, number][] = [];
      const step = Math.max(1, Math.ceil(n / 48));
      for (let i = 0; i < n; i += step) {
        out.push([polygon[i * 2], polygon[i * 2 + 1]]);
      }
      return out;
    };

    const strictlyInside = (frame: PlaneFrame, polygon: number[]): boolean => {
      const pts = samples(polygon);
      if (pts.length === 0) return false;
      for (const [u, v] of pts) {
        const w = uvTo3d(frame, u, v);
        const cls = new k.BRepClass_FaceClassifier_4(
          faceT,
          pnt(w[0], w[1], w[2]),
          1e-6,
          false,
          0.1,
        );
        const st = cls.State();
        cls.delete();
        if (st !== k.TopAbs_State.TopAbs_IN) return false;
      }
      return true;
    };

    // Collect coplanar sketch regions fully inside the face.
    const regions: { sk: SketchOnPlane; profile: Profile }[] = [];
    for (const sk of sketches) {
      const n = sk.frame.normal;
      const o = sk.frame.origin;
      const ndot = Math.abs(n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2]);
      if (ndot < 1 - 1e-6) continue;
      const doff = Math.abs(
        (o[0] - fp[0]) * fn[0] +
          (o[1] - fp[1]) * fn[1] +
          (o[2] - fp[2]) * fn[2],
      );
      if (doff > 1e-5) continue;
      for (const p of sk.profiles) {
        if (p.area <= 1e-9) continue;
        if (strictlyInside(sk.frame, p.polygon))
          regions.push({ sk, profile: p });
      }
    }
    if (regions.length === 0) return noop;

    return kernelCall("face region subtraction", () => {
      // One boolean cut with all region faces as a compound tool (regions
      // may nest — e.g. a rect region containing a circle region — and the
      // union of all of them is what gets removed).
      const builder = new k.BRep_Builder();
      const comp = new k.TopoDS_Compound();
      builder.MakeCompound(comp);
      for (const { sk, profile } of regions) {
        const pf = buildProfileFace(profile, sk.entities, sk.frame);
        builder.Add(comp, pf.face);
      }
      const op = new k.BRepAlgoAPI_Cut_3(faceT, comp, progress());
      op.Build(progress());
      if (!op.IsDone()) {
        op.delete();
        return noop;
      }
      const result = op.Shape();
      op.delete();

      // Expect exactly one face back (regions are strictly interior).
      const ex = new k.TopExp_Explorer_2(
        result,
        k.TopAbs_ShapeEnum.TopAbs_FACE,
        k.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      const cutFaces: Shape[] = [];
      while (ex.More()) {
        cutFaces.push(k.TopoDS.Face_1(ex.Current()));
        ex.Next();
      }
      ex.delete();
      if (cutFaces.length !== 1) return noop;
      const cutFace = cutFaces[0];

      // Name the new hole edges after the sketch entities they came from,
      // so hole side-walls get stable persistent names.
      const edgeEntity = new Map<number, string>();
      const bySketch = new Map<SketchOnPlane, Set<string>>();
      for (const { sk, profile } of regions) {
        let ids = bySketch.get(sk);
        if (!ids) bySketch.set(sk, (ids = new Set()));
        for (const c of profile.outer) ids.add(c.entityId);
        for (const h of profile.holes) for (const c of h) ids.add(c.entityId);
      }
      for (const [sk, ids] of bySketch) {
        const matched = matchEdgesToEntities(
          cutFace,
          [...ids],
          buildMaps(sk.entities),
          sk.frame,
        );
        for (const [h, id] of matched) edgeEntity.set(h, id);
      }
      return { face: cutFace, edgeEntity };
    });
  } catch {
    return noop;
  }
}

/** Build a planar OCCT face for a detected profile. */
export function buildProfileFace(
  profile: Profile,
  entities: SketchEntity[],
  frame: PlaneFrame,
): ProfileFace {
  return kernelCall(`profile ${profile.id}`, () => {
    const k = getKernel();
    const maps = buildMaps(entities);
    const snap = snapper();
    const edgeEntity = new Map<number, string>();

    const outerWire = buildWire(profile.outer, maps, frame, snap, edgeEntity);

    const pln = new k.gp_Pln_3(
      pnt(frame.origin[0], frame.origin[1], frame.origin[2]),
      dir(frame.normal[0], frame.normal[1], frame.normal[2]),
    );
    const faceMk = new k.BRepBuilderAPI_MakeFace_16(pln, outerWire, true);
    if (!faceMk.IsDone()) {
      faceMk.delete();
      throw new Error("failed to build profile face");
    }
    let face = faceMk.Face();
    faceMk.delete();
    pln.delete();

    for (const hole of profile.holes) {
      const holeWire = buildWire(hole, maps, frame, snap, edgeEntity);
      // Hole wires must oppose the outer wire orientation.
      const reversedWire = k.TopoDS.Wire_1(holeWire.Reversed());
      const withHole = new k.BRepBuilderAPI_MakeFace_22(face, reversedWire);
      if (!withHole.IsDone()) {
        withHole.delete();
        throw new Error("failed to add hole to profile face");
      }
      face = withHole.Face();
      withHole.delete();
    }

    // Re-derive edge → entity mapping from the final face geometry.
    const chainIds = [
      ...profile.outer.map((c) => c.entityId),
      ...profile.holes.flatMap((h) => h.map((c) => c.entityId)),
    ];
    const finalEdgeEntity = matchEdgesToEntities(face, chainIds, maps, frame);

    return { face, edgeEntity: finalEdgeEntity, profileId: profile.id };
  });
}
