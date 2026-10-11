import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import {
  acquire,
  dir,
  edges as edgesOf,
  explore,
  getKernel,
  kernelCall,
  listToArray,
  pnt,
  progress,
  transformOp,
  vec,
  vertices,
  wires as wiresOf,
  type Shape,
} from "./kernel.js";
import { capName, finalizeNames, sideName } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { vertexPoint, type ToolResult } from "./featureState.js";
import { V } from "./frames.js";
import type { ProfileFace } from "./sketchGeom.js";

export interface Section {
  at: number;
  offset: number;
}

export interface Level {
  shape: Shape;
  images: Shape[];
}

const CLOSES =
  "the taper closes the profile before the end; lower the taper angle or the distance";

export function taperedPrism(
  featureId: string,
  pf: ProfileFace,
  n: Vec3,
  sections: Section[],
): ToolResult {
  const built = kernelCall("tapered extrude", () => {
    const source = edgesOf(pf.face);
    const levels = sections.map((s) => level(pf.face, source, n, s));
    if (!levels.every((lv): lv is Level => lv !== null))
      return { error: CLOSES };
    const provisional = new ShapeMap<string>();
    const cells: [Shape, string | undefined][] = [
      [cap(pf.face, source, levels[0]!), capName(featureId, "start")],
      [cap(pf.face, source, levels.at(-1)!), capName(featureId, "end")],
    ];
    for (const wire of wiresOf(pf.face))
      cells.push(...ruledSides(featureId, pf, wire, source, levels));
    const sew = acquire(
      new (getKernel().BRepBuilderAPI_Sewing)(
        LINEAR_TOL,
        true,
        true,
        true,
        false,
      ),
    );
    for (const [face] of cells) sew.Add(face);
    sew.Perform(progress());
    if (sew.NbFreeEdges() || sew.NbMultipleEdges())
      throw new Error("the tapered side faces do not close");
    const shape = solidOf(acquire(sew.SewedShape()));
    for (const [face, name] of cells) {
      if (!name) continue;
      const made = sew.IsModified(face) ? acquire(sew.Modified(face)) : face;
      provisional.set(made, name);
    }
    return { shape, names: finalizeNames(shape, provisional, featureId) };
  });
  if ("error" in built) throw new Error(built.error);
  return built;
}

export function offsetLoops(
  face: Shape,
  source: Shape[],
  offset: number,
): Level | null {
  if (offset === 0) return { shape: face, images: source };
  const k = getKernel();
  const mk = acquire(
    new k.BRepOffsetAPI_MakeOffset_2(
      face,
      k.GeomAbs_JoinType.GeomAbs_Intersection,
      false,
    ),
  );
  mk.Perform(offset, 0);
  if (!mk.IsDone()) return null;
  const made = source.map((e) =>
    listToArray(mk.Generated(e)).filter(
      (g) => g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_EDGE,
    ),
  );
  if (made.some((m) => m.length !== 1)) return null;
  return { shape: acquire(mk.Shape()), images: made.map((m) => m[0]!) };
}

function level(
  face: Shape,
  source: Shape[],
  n: Vec3,
  { at, offset }: Section,
): Level | null {
  const flat = offsetLoops(face, source, offset);
  if (!flat) return null;
  const k = getKernel();
  const trsf = acquire(new k.gp_Trsf_1());
  trsf.SetTranslation_1(vec(n[0] * at, n[1] * at, n[2] * at));
  const tr = transformOp(flat.shape, trsf);
  return {
    shape: acquire(tr.Shape()),
    images: flat.images.map((e) => acquire(tr.ModifiedShape(e))),
  };
}

function imageWire(lv: Level, source: Shape[], wire: Shape): Shape {
  const first = source.findIndex((e) => e.IsSame(edgesOf(wire)[0]));
  const image = lv.images[first];
  const found = wiresOf(lv.shape).find((w) =>
    edgesOf(w).some((e) => e.IsSame(image)),
  );
  if (!found) throw new Error("a tapered profile loop was lost");
  return getKernel().TopoDS.Wire_1(found);
}

export function cap(face: Shape, source: Shape[], lv: Level): Shape {
  const k = getKernel();
  if (lv.shape.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE)
    return k.TopoDS.Face_1(lv.shape);
  const outer = acquire(k.BRepTools.OuterWire(face));
  const mk = acquire(
    new k.BRepBuilderAPI_MakeFace_15(imageWire(lv, source, outer), true),
  );
  for (const wire of wiresOf(face))
    if (!wire.IsSame(outer)) mk.Add(imageWire(lv, source, wire));
  if (!mk.IsDone()) throw new Error("a tapered end face failed");
  return acquire(mk.Face());
}

function ruledSides(
  featureId: string,
  pf: ProfileFace,
  wire: Shape,
  source: Shape[],
  levels: Level[],
): [Shape, string | undefined][] {
  const k = getKernel();
  const thru = acquire(
    new k.BRepOffsetAPI_ThruSections(false, true, LINEAR_TOL),
  );
  for (const lv of levels) thru.AddWire(imageWire(lv, source, wire));
  thru.Build(progress());
  if (!thru.IsDone()) throw new Error("the tapered side faces failed");
  return edgesOf(wire).flatMap((edge) => {
    const index = source.findIndex((e) => e.IsSame(edge));
    const entity = pf.edgeEntity.get(edge);
    const name = entity ? sideName(featureId, entity) : undefined;
    const straight =
      acquire(new k.BRepAdaptor_Curve_2(edge)).GetType() ===
      k.GeomAbs_CurveType.GeomAbs_Line;
    return listToArray(thru.Generated(levels[0]!.images[index]))
      .filter((g) => g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE)
      .map((face): [Shape, string | undefined] => [
        planar(face, straight),
        name,
      ]);
  });
}

function planar(face: Shape, straight: boolean): Shape {
  const k = getKernel();
  const typed = k.TopoDS.Face_1(face);
  if (!straight) return typed;
  const [a, ...rest] = vertices(typed).map(vertexPoint);
  const normal = rest
    .flatMap((b, i) =>
      rest.slice(i + 1).map((c) => V.cross(V.sub(b, a!), V.sub(c, a!))),
    )
    .reduce((best, v) => (V.norm(v) > V.norm(best) ? v : best));
  const plane = acquire(
    new k.gp_Pln_3(acquire(pnt(...a!)), acquire(dir(...V.normalize(normal)))),
  );
  const mk = acquire(
    new k.BRepBuilderAPI_MakeFace_16(
      plane,
      acquire(k.BRepTools.OuterWire(typed)),
      true,
    ),
  );
  if (!mk.IsDone()) throw new Error("a tapered side face failed");
  return acquire(mk.Face());
}

function solidOf(sewn: Shape): Shape {
  const k = getKernel();
  const solid = acquire(new k.BRepBuilderAPI_MakeSolid_1());
  for (const shell of explore(sewn, "shell"))
    solid.Add(acquire(k.TopoDS.Shell_1(shell)));
  const result = acquire(solid.Solid());
  if (!k.BRepLib.OrientClosedSolid(result))
    throw new Error("the tapered extrude could not be oriented");
  return result;
}
