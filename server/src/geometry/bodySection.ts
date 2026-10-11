import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type BodyRef,
  type ExactCurve,
  type FaceRef,
  type PlaneFrame,
  type Vec3,
} from "@rockett/shared";
import {
  dir,
  edges,
  faces,
  getKernel,
  kernelCall,
  lengthOf,
  listToArray,
  pnt,
  progress,
  scoped,
  type Own,
  type Shape,
} from "./kernel.js";
import { exactCurve } from "./edgeCurve.js";
import { pointToUV, V } from "./frames.js";
import { findFace, type NamedBody } from "./naming.js";
import { memberKey, type OutlinePiece } from "./bodyOutline.js";

type Source = FaceRef | BodyRef;

export class SectionMiss extends Error {
  readonly verb: string;

  constructor(
    readonly of: Source,
    touches: boolean,
  ) {
    const verb = touches ? "only touches" : "misses";
    super(
      `The sketch plane ${verb} this ${of.kind}. Choose a ${of.kind} the plane crosses.`,
    );
    this.verb = verb;
  }
}

const UNBUILT = "Could not cut this face or body at the sketch plane.";

const PROBE = 0.1;

const xyz = (p: any): Vec3 => [p.X(), p.Y(), p.Z()];

function along(face: Shape, from: Vec3, normal: Vec3, own: Own) {
  const k = getKernel();
  const at = V.add(from, V.scale(normal, PROBE));
  const vertex = own(
    own(new k.BRepBuilderAPI_MakeVertex(own(pnt(...at)))).Vertex(),
  );
  const dist = own(
    new k.BRepExtrema_DistShapeShape_2(
      face,
      vertex,
      k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      progress(),
    ),
  );
  if (!dist.IsDone()) throw new Error(UNBUILT);
  const back = V.sub(at, xyz(own(dist.PointOnShape1(1))));
  const gap = Math.hypot(...back);
  return (
    gap > LINEAR_TOL && Math.abs(V.dot(back, normal)) / gap > 1 - UNIT_DOT_TOL
  );
}

function grazes(face: Shape, mid: Vec3, normal: Vec3, own: Own) {
  return (
    along(face, mid, normal, own) && along(face, mid, V.scale(normal, -1), own)
  );
}

function middle(edge: Shape, own: Own): Vec3 {
  const curve = own(new (getKernel().BRepAdaptor_Curve_2)(edge));
  const mid = (curve.FirstParameter() + curve.LastParameter()) / 2;
  return xyz(own(curve.Value(mid)));
}

interface Cut {
  name: string;
  at: { u: number; v: number };
  curve: ExactCurve;
}

function cuts(body: NamedBody, frame: PlaneFrame, of: Source) {
  return scoped((own) => {
    const k = getKernel();
    const target =
      of.kind === "face" ? findFace(body, of.faceName) : body.shape;
    if (!target) return undefined;
    const plane = own(
      new k.gp_Pln_3(own(pnt(...frame.origin)), own(dir(...frame.normal))),
    );
    const op = own(new k.BRepAlgoAPI_Section_5(target, plane, false));
    op.SetNonDestructive(true);
    op.Approximation(true);
    op.Build(progress());
    if (!op.IsDone()) throw new Error(UNBUILT);
    const sources = faces(target).map((face) => ({
      face,
      name: body.names.get(face),
      made: [
        ...listToArray(op.Generated(face)),
        ...edges(face).flatMap((edge) =>
          listToArray(op.Modified(edge)).concat(edge),
        ),
      ].map(own),
    }));
    const found = edges(own(op.Shape())).filter(
      (edge) => lengthOf(edge) > LINEAR_TOL,
    );
    const crossing = found.flatMap((edge): Cut[] => {
      const mid = middle(edge, own);
      const on = sources.filter(({ made }) => made.some((m) => m.IsSame(edge)));
      if (!on.length) throw new Error(UNBUILT);
      if (on.some(({ face }) => grazes(face, mid, frame.normal, own)))
        return [];
      const [first] = on.flatMap(({ name }) => name ?? []).toSorted();
      if (!first) throw new Error(UNBUILT);
      return [
        { name: first, at: pointToUV(frame, mid), curve: exactCurve(edge) },
      ];
    });
    return { crossing, touched: found.length > 0 };
  });
}

const placed = (a: Cut, b: Cut) => a.at.u - b.at.u || a.at.v - b.at.v;

function keyed(crossing: Cut[]): OutlinePiece[] {
  const runs = new Map<string, Cut[]>();
  for (const cut of crossing) {
    const key = memberKey(cut.name);
    runs.set(key, [...(runs.get(key) ?? []), cut]);
  }
  return [...runs]
    .flatMap(([key, run]) =>
      run.length === 1
        ? [{ key, curve: run[0]!.curve }]
        : run
            .toSorted(placed)
            .map(({ curve }, i) => ({ key: `${key}-${i + 1}`, curve })),
    )
    .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function bodySection(
  body: NamedBody,
  frame: PlaneFrame,
  of: Source,
): OutlinePiece[] | undefined {
  let found: ReturnType<typeof cuts>;
  try {
    found = kernelCall("body section", () => cuts(body, frame, of));
  } catch (error) {
    const cause = (error as Error).cause;
    throw cause instanceof Error ? cause : new Error(UNBUILT, { cause: error });
  }
  if (!found) return undefined;
  if (!found.crossing.length) throw new SectionMiss(of, found.touched);
  return keyed(found.crossing);
}
