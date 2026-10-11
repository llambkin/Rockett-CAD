import {
  LINEAR_TOL,
  sketchCurves,
  type ExtrudeFeature,
  type ExtrudeThin,
  type SketchEntityRef,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  dir,
  edges as edgesOf,
  faces as facesOf,
  getKernel,
  kernelCall,
  listToArray,
  pnt,
  wires as wiresOf,
  type Shape,
} from "./kernel.js";
import { cutOperation } from "./boolean.js";
import { vertexPoint, type EvalState } from "./featureState.js";
import { V } from "./frames.js";
import { ShapeMap } from "./shapeMap.js";
import { pieceEdge } from "./sketchEdges.js";
import {
  buildMaps,
  matchEdgesToEntities,
  snapper,
  type ProfileFace,
} from "./sketchGeom.js";
import { cap, offsetLoops } from "./taper.js";

interface Source {
  pf: ProfileFace;
  n: Vec3;
  copy: boolean;
}

interface Piece {
  id: string;
  ends: [Vec3, Vec3];
}

interface Link {
  id: string;
  reversed: boolean;
}

type Built<T> = T | { error: string };

const TOO_THICK =
  "the wall is thicker than the profile allows; lower the thickness";
const TAPERED = "a thin extrude takes no taper yet; set the taper angle to 0";
const CLOSED = "the picked curves close a loop; pick its profile instead";
const BRANCHES = "the picked curves branch; pick chains that do not fork";
const missing = (ref: SketchEntityRef) =>
  `sketch curve ${ref.entityId} in ${ref.sketchId} was deleted or is construction`;

export function thinSources(
  state: EvalState,
  f: ExtrudeFeature,
  thin: ExtrudeThin,
  sources: Source[],
): Source[] {
  const tapered =
    (f.taper ?? 0) !== 0 ||
    (f.direction === "twoSided" && (f.taper2 ?? 0) !== 0);
  if (tapered) throw new Error(TAPERED);
  for (const ref of f.curves ?? []) {
    const sketch = state.sketches.get(ref.sketchId);
    if (!sketch) throw new Error(`sketch ${ref.sketchId} not found`);
    if (!sketchCurves(sketch.entities).some((c) => c.id === ref.entityId))
      throw new Error(missing(ref));
  }
  const built = kernelCall("thin extrude", (): Built<Source[]> => {
    const out: Source[] = [];
    for (const s of sources) {
      const walls = closedWalls(s.pf, thin);
      if ("error" in walls) return walls;
      out.push(...walls.map((pf) => ({ ...s, pf })));
    }
    for (const [sketchId, refs] of bySketch(f.curves ?? [])) {
      const walls = openWalls(state, sketchId, refs, thin);
      if ("error" in walls) return walls;
      out.push(...walls);
    }
    return out;
  });
  if ("error" in built) throw new Error(built.error);
  return built;
}

const outward = ({ location, thickness: t }: ExtrudeThin): [number, number] =>
  location === "inside"
    ? [0, -t]
    : location === "outside"
      ? [t, 0]
      : [t / 2, -t / 2];

function closedWalls(pf: ProfileFace, thin: ExtrudeThin): Built<ProfileFace[]> {
  const source = edgesOf(pf.face);
  const [outer, inner] = outward(thin).map((d) =>
    offsetLoops(pf.face, source, d),
  );
  if (!outer || !inner) return { error: TOO_THICK };
  const op = cutOperation(
    cap(pf.face, source, outer),
    cap(pf.face, source, inner),
  );
  if (!op.IsDone()) throw new Error("the thin wall failed");
  const walls = facesOf(acquire(op.Shape()));
  if (walls.length === 0) return { error: TOO_THICK };
  const edgeEntity = new ShapeMap<string>();
  source.forEach((edge, i) => {
    const entity = pf.edgeEntity.get(edge);
    if (!entity) return;
    for (const image of [outer.images[i]!, inner.images[i]!]) {
      const pieces = listToArray(op.Modified(image));
      for (const piece of pieces.length > 0 ? pieces : [image])
        edgeEntity.set(piece, entity);
    }
  });
  return walls.map((face) => ({ face, edgeEntity, profileId: pf.profileId }));
}

function bySketch(refs: SketchEntityRef[]) {
  const groups = new Map<string, SketchEntityRef[]>();
  for (const ref of refs)
    groups.set(ref.sketchId, [...(groups.get(ref.sketchId) ?? []), ref]);
  return groups;
}

function openWalls(
  state: EvalState,
  sketchId: string,
  refs: SketchEntityRef[],
  thin: ExtrudeThin,
): Built<Source[]> {
  const sketch = state.sketches.get(sketchId)!;
  const { frame } = sketch;
  const curves = new Map(sketchCurves(sketch.entities).map((c) => [c.id, c]));
  const snap = snapper();
  const edge = ({ id, reversed }: Link) =>
    pieceEdge(frame, curves.get(id)!, { reversed }, snap);
  const k = getKernel();
  const pieces = refs.map((ref): Piece => {
    const e = edge({ id: ref.entityId, reversed: false });
    return {
      id: ref.entityId,
      ends: [
        vertexPoint(acquire(k.TopExp.FirstVertex(e, true))),
        vertexPoint(acquire(k.TopExp.LastVertex(e, true))),
      ],
    };
  });
  const pln = acquire(
    new k.gp_Pln_3(
      acquire(pnt(...frame.origin)),
      acquire(dir(...frame.normal)),
    ),
  );
  const plane = acquire(new k.BRepBuilderAPI_MakeFace_3(pln)).Face();
  const linked = chains(pieces);
  if ("error" in linked) return linked;
  const out: Source[] = [];
  for (const links of linked) {
    const mk = acquire(new k.BRepBuilderAPI_MakeWire_1());
    const edges = links.map((link) => {
      mk.Add_1(edge(link));
      return acquire(mk.Edge());
    });
    if (!mk.IsDone()) throw new Error("the picked curves do not connect");
    const wire = acquire(mk.Wire());
    const ids = links.map((l) => l.id);
    const maps = buildMaps(sketch.entities);
    const named = matchEdgesToEntities(wire, ids, maps, frame);
    const wall = openWall(pln, plane, { wire, edges, edgeEntity: named }, thin);
    if ("error" in wall) return wall;
    out.push({
      pf: { ...wall, profileId: `curves:${ids.join(",")}` },
      n: frame.normal,
      copy: false,
    });
  }
  return out;
}

const near = (a: Vec3, b: Vec3) => V.norm(V.sub(a, b)) < LINEAR_TOL;

function chains(pieces: Piece[]): Built<Link[][]> {
  const left = [...pieces];
  const out: Link[][] = [];
  const take = (at: Vec3) => {
    const found = left.filter((p) => p.ends.some((e) => near(e, at)));
    if (found.length > 1) return "branch";
    const piece = found[0];
    if (piece) left.splice(left.indexOf(piece), 1);
    return piece;
  };
  while (left.length > 0) {
    const first = left.shift()!;
    let [head, tail] = first.ends;
    const links: Link[] = [{ id: first.id, reversed: false }];
    for (const forward of [true, false]) {
      for (;;) {
        if (near(head, tail)) return { error: CLOSED };
        const at = forward ? tail : head;
        const p = take(at);
        if (p === "branch") return { error: BRANCHES };
        if (!p) break;
        const flip = !near(p.ends[forward ? 0 : 1], at);
        const link = { id: p.id, reversed: flip };
        if (forward) {
          links.push(link);
          tail = p.ends[flip ? 0 : 1];
        } else {
          links.unshift(link);
          head = p.ends[flip ? 1 : 0];
        }
      }
    }
    out.push(links);
  }
  return out;
}

interface Rail {
  wire: Shape;
  edges: Shape[];
  edgeEntity: ShapeMap<string>;
}

function rail(plane: Shape, spine: Rail, right: number): Rail | null {
  if (right === 0) return spine;
  const k = getKernel();
  const wire =
    right < 0
      ? spine.wire
      : acquire(k.TopoDS.Wire_1(acquire(spine.wire.Reversed())));
  const mk = acquire(
    new k.BRepOffsetAPI_MakeOffset_2(
      plane,
      k.GeomAbs_JoinType.GeomAbs_Intersection,
      true,
    ),
  );
  mk.AddWire(wire);
  mk.Perform(Math.abs(right), 0);
  if (!mk.IsDone()) return null;
  const made = wiresOf(acquire(mk.Shape()));
  if (made.length !== 1) return null;
  const images = spine.edges.map((e) =>
    listToArray(mk.Generated(e)).filter(
      (g) => g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_EDGE,
    ),
  );
  if (images.some((m) => m.length !== 1)) return null;
  const edges = images.map((m) => acquire(k.TopoDS.Edge_1(m[0]!)));
  const edgeEntity = new ShapeMap<string>();
  spine.edges.forEach((e, i) => {
    const entity = spine.edgeEntity.get(e);
    if (entity) edgeEntity.set(edges[i]!, entity);
  });
  return { wire: k.TopoDS.Wire_1(made[0]!), edges, edgeEntity };
}

function ends(wire: Shape): [Shape, Shape] {
  const k = getKernel();
  const a = acquire(new k.TopoDS_Vertex());
  const b = acquire(new k.TopoDS_Vertex());
  k.TopExp.Vertices_2(wire, a, b);
  return [a, b];
}

function endsFrom(wire: Shape, start: Vec3): [Shape, Shape] {
  const [a, b] = ends(wire);
  const gap = (v: Shape) => V.norm(V.sub(vertexPoint(v), start));
  return gap(a) <= gap(b) ? [a, b] : [b, a];
}

function openWall(
  pln: unknown,
  plane: Shape,
  spine: Rail,
  thin: ExtrudeThin,
): Built<{ face: Shape; edgeEntity: ShapeMap<string> }> {
  const k = getKernel();
  const [hi, lo] = outward(thin).map((d) => rail(plane, spine, d));
  if (!hi || !lo) return { error: TOO_THICK };
  const start = vertexPoint(ends(spine.wire)[0]);
  const [h0, h1] = endsFrom(hi.wire, start);
  const [l0, l1] = endsFrom(lo.wire, start);
  const link = (a: Shape, b: Shape) =>
    acquire(new k.BRepBuilderAPI_MakeEdge_2(a, b)).Edge();
  const mk = acquire(new k.BRepBuilderAPI_MakeWire_1());
  for (const e of [
    ...hi.edges,
    link(h1, l1),
    ...lo.edges.toReversed(),
    link(l0, h0),
  ])
    mk.Add_1(e);
  if (!mk.IsDone()) throw new Error("the thin wall outline failed");
  const face = acquire(
    new k.BRepBuilderAPI_MakeFace_16(pln, acquire(mk.Wire()), true),
  );
  if (!face.IsDone()) throw new Error("the thin wall failed");
  const edgeEntity = new ShapeMap<string>();
  for (const r of [hi, lo])
    for (const e of r.edges) {
      const entity = r.edgeEntity.get(e);
      if (entity) edgeEntity.set(e, entity);
    }
  return { face: acquire(face.Face()), edgeEntity };
}
