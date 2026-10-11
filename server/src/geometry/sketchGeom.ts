/**
 * Solved sketch → OCCT B-Rep profile faces.
 *
 * Takes solved sketch entities (from the shared constraint solver), the
 * detected profile regions (shared/profiles.ts), and the sketch plane frame,
 * and produces planar TopoDS_Face objects with an edge → sketch-entity map
 * used for persistent side-face naming during extrude/revolve.
 */

import type {
  OrientedCurve,
  PlaneFrame,
  Profile,
  SketchCurve,
  SketchEntity,
} from "@rockett/shared";
import { curveDistance, LINEAR_TOL, sketchCurves } from "@rockett/shared";
import {
  acquire,
  getKernel,
  edges as edgesOf,
  kernelCall,
  pnt,
  dir,
  scoped,
  type Shape,
} from "./kernel.js";
import { sideName } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { pieceEdge } from "./sketchEdges.js";

export interface ProfileFace {
  face: Shape; // TopoDS_Face
  edgeEntity: ShapeMap<string>;
  profileId: string;
}

interface EntityMaps {
  curves: Map<string, SketchCurve>;
}

export function buildMaps(entities: SketchEntity[]): EntityMaps {
  return {
    curves: new Map(sketchCurves(entities, true).map((c) => [c.id, c])),
  };
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

function buildWire(
  chain: OrientedCurve[],
  maps: EntityMaps,
  frame: PlaneFrame,
  snap: (x: number, y: number) => [number, number],
): Shape {
  const k = getKernel();
  const wireMaker = acquire(new k.BRepBuilderAPI_MakeWire_1());
  for (const oc of chain) {
    const curve = maps.curves.get(oc.entityId);
    if (!curve)
      throw new Error(`profile references unknown entity ${oc.entityId}`);
    wireMaker.Add_1(pieceEdge(frame, curve, oc, snap));
    if (!wireMaker.IsDone()) {
      throw new Error(
        `failed to connect profile wire at entity ${oc.entityId}`,
      );
    }
  }
  return acquire(wireMaker.Wire());
}

export function matchEdgesToEntities(
  face: Shape,
  chainIds: string[],
  maps: EntityMaps,
  frame: PlaneFrame,
): ShapeMap<string> {
  return scoped(() => {
    const k = getKernel();
    const result = new ShapeMap<string>();
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
    const ex = acquire(
      new k.TopExp_Explorer_2(
        face,
        k.TopAbs_ShapeEnum.TopAbs_EDGE,
        k.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    while (ex.More()) {
      const current = acquire(ex.Current());
      const edge = acquire(k.TopoDS.Edge_1(current));
      const curve = acquire(new k.BRepAdaptor_Curve_2(edge));
      const tMid = (curve.FirstParameter() + curve.LastParameter()) / 2;
      const mid3d = acquire(curve.Value(tMid));
      const [u, v] = toUV(mid3d);

      let best: { id: string; d: number } | null = null;
      for (const id of chainIds) {
        const known = maps.curves.get(id);
        const d = known ? curveDistance(known, u, v) : Infinity;
        if (best === null || d < best.d) best = { id, d };
      }
      if (best && best.d < 1e-4) {
        result.set(edge, best.id);
      }
      ex.Next();
    }
    return result;
  });
}

/** Minimal evaluated-sketch shape needed for face-region subtraction. */
export interface SketchOnPlane {
  frame: PlaneFrame;
  entities: SketchEntity[];
  profiles: Profile[];
}

export function buildProfileFace(
  profile: Profile,
  entities: SketchEntity[],
  frame: PlaneFrame,
): ProfileFace {
  const result = kernelCall(`profile ${profile.id}`, () =>
    scoped((profileOwn) => {
      const k = getKernel();
      const maps = buildMaps(entities);
      const snap = snapper();

      const outerWire = buildWire(profile.outer, maps, frame, snap);

      let face = acquire(
        scoped((own) => {
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
          return own.keep(own(faceMk.Face()));
        }),
      );

      for (const hole of profile.holes) {
        const outer = face;
        face = acquire(
          scoped((own) => {
            own(outer);
            const holeWire = own(buildWire(hole, maps, frame, snap));
            const reversedWire = own(k.TopoDS.Wire_1(own(holeWire.Reversed())));
            const withHole = own(
              new k.BRepBuilderAPI_MakeFace_22(outer, reversedWire),
            );
            if (!withHole.IsDone())
              throw new Error("failed to add hole to profile face");
            return own.keep(own(withHole.Face()));
          }),
        );
      }

      const chainIds = [
        ...profile.outer.map((c) => c.entityId),
        ...profile.holes.flatMap((h) => h.map((c) => c.entityId)),
      ];
      const finalEdgeEntity = matchEdgesToEntities(face, chainIds, maps, frame);

      return {
        face: profileOwn.keep(face),
        edgeEntity: finalEdgeEntity,
        profileId: profile.id,
      };
    }),
  );
  acquire(result.face);
  return result;
}

export function sideEdgeNames(
  featureId: string,
  pf: ProfileFace,
  edges?: Shape[],
): Array<[Shape, string]> {
  const named = scoped((own) =>
    (edges ?? edgesOf(pf.face)).flatMap((edge): Array<[Shape, string]> => {
      const entityId = pf.edgeEntity.get(edge);
      return entityId ? [[own.keep(edge), sideName(featureId, entityId)]] : [];
    }),
  );
  if (!edges) for (const [edge] of named) acquire(edge);
  return named;
}
