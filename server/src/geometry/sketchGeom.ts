/**
 * Solved sketch → OCCT B-Rep profile faces.
 *
 * Takes solved sketch entities (from the shared constraint solver), the
 * detected profile regions (shared/profiles.ts), and the sketch plane frame,
 * and produces planar TopoDS_Face objects with an edge → sketch-entity map
 * used for persistent side-face naming during extrude/revolve.
 */

import type { PlaneFrame, Profile, SketchEntity, Vec3 } from "@rockett/shared";
import { arcAngles, LINEAR_TOL } from "@rockett/shared";
import {
  getKernel,
  kernelCall,
  pnt,
  dir,
  release,
  scoped,
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

export function buildMaps(entities: SketchEntity[]): EntityMaps {
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
export function snapper(): (x: number, y: number) => [number, number] {
  const known: [number, number][] = [];
  return (x, y) => {
    for (const k of known) {
      if (Math.hypot(k[0] - x, k[1] - y) < LINEAR_TOL) return k;
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
  return scoped((own) => {
    const arcMk = own(
      new k.GC_MakeArcOfCircle_4(
        own(pnt(...p1)),
        own(pnt(...pm)),
        own(pnt(...p2)),
      ),
    );
    const curve = own(k.upcastCurve(own(arcMk.Value())));
    return own(new k.BRepBuilderAPI_MakeEdge_24(curve)).Edge();
  });
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
      edge = scoped((own) =>
        own(
          new k.BRepBuilderAPI_MakeEdge_3(
            own(pnt(p1[0], p1[1], p1[2])),
            own(pnt(p2[0], p2[1], p2[2])),
          ),
        ).Edge(),
      );
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
      edge = scoped((own) => {
        const ax2 = own(
          new k.gp_Ax2_2(
            own(pnt(c3[0], c3[1], c3[2])),
            own(dir(frame.normal[0], frame.normal[1], frame.normal[2])),
            own(dir(frame.xAxis[0], frame.xAxis[1], frame.xAxis[2])),
          ),
        );
        const circ = own(new k.gp_Circ_2(ax2, circle.radius));
        return own(new k.BRepBuilderAPI_MakeEdge_8(circ)).Edge();
      });
    }
    if (!edge)
      throw new Error(`profile references unknown entity ${oc.entityId}`);
    edgeEntity.set(shapeHash(edge), oc.entityId);
    wireMaker.Add_1(edge);
    edge.delete();
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
export function matchEdgesToEntities(
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
    const current = ex.Current();
    const edge = k.TopoDS.Edge_1(current);
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
    release([current, edge]);
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

    let face = scoped((own) => {
      const pln = own(
        new k.gp_Pln_3(
          own(pnt(frame.origin[0], frame.origin[1], frame.origin[2])),
          own(dir(frame.normal[0], frame.normal[1], frame.normal[2])),
        ),
      );
      const faceMk = own(
        new k.BRepBuilderAPI_MakeFace_16(pln, own(outerWire), true),
      );
      if (!faceMk.IsDone()) throw new Error("failed to build profile face");
      return faceMk.Face();
    });

    for (const hole of profile.holes) {
      const outer = face;
      face = scoped((own) => {
        own(outer);
        const holeWire = own(buildWire(hole, maps, frame, snap, edgeEntity));
        const reversedWire = own(k.TopoDS.Wire_1(own(holeWire.Reversed())));
        const withHole = own(
          new k.BRepBuilderAPI_MakeFace_22(outer, reversedWire),
        );
        if (!withHole.IsDone())
          throw new Error("failed to add hole to profile face");
        return withHole.Face();
      });
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
