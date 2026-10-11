import {
  edges as edgesOf,
  explore,
  faces as facesOf,
  getKernel,
  listToArray,
  progress,
  scoped,
  shapeHash,
  shapeList,
  vertices as verticesOf,
  type Shape,
} from "./kernel.js";
import { rejectInvalid } from "./featureState.js";
import { spilledEnds } from "./blendEnds.js";

export function rejectBadBlend(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  before: Shape,
  kind: "fillet" | "chamfer",
  size: string,
  advice: string,
): void {
  rejectInvalid(result, before, kind, size, advice);
  rejectLooseBlend(Boolean(op && looseBlend(op, sourceEdges, result)), kind);
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

const CONTACT = 0.01;
const LOOSE = 1e-3;

interface Patch {
  face: Shape;
  edges: Set<number>;
  tolerance: number;
  box: any;
}

function shellCount(shape: Shape): number {
  return scoped(() => {
    const shells = [...explore(shape, "shell")];

    return shells.length;
  });
}

function generatedBy(op: any, sourceEdges: { edge: Shape }[]): Set<number> {
  return scoped(() => {
    const made = new Set<number>();
    for (const { edge } of sourceEdges) {
      const ends = verticesOf(edge);
      for (const from of [edge, ...ends]) {
        const generated = listToArray(op.Generated(from));
        for (const shape of generated) made.add(shapeHash(shape));
      }
    }
    return made;
  });
}

function toleranceOf(face: Shape): number {
  const k = getKernel();
  return Math.max(
    ...["VERTEX", "EDGE", "FACE"].map((type) =>
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum[`TopAbs_${type}`]),
    ),
  );
}

export function looseBlend(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
): boolean {
  return scoped(() => {
    const made = generatedBy(op, sourceEdges);
    const all = facesOf(result);
    const loose = all.some(
      (face) => made.has(shapeHash(face)) && toleranceOf(face) > LOOSE,
    );

    return loose;
  });
}

function patch(face: Shape, box: any): Patch {
  return scoped(() => {
    const k = getKernel();
    const tolerance = toleranceOf(face);
    if (tolerance > CONTACT) k.BRepBndLib.AddOptimal(face, box, false, false);
    else k.BRepBndLib.Add(face, box, true);
    box.Enlarge(CONTACT);
    const around = edgesOf(face);
    const hashes = new Set(around.map(shapeHash));

    return { face, edges: hashes, tolerance, box };
  });
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
  return blendCutsThrough(made, result);
}

export function rejectSewnBlend(
  result: Shape,
  before: Shape,
  made: Shape[],
  kind: "fillet" | "chamfer",
  value: number,
): void {
  const measure = kind === "fillet" ? "radius" : "distance";
  const size = `${measure} ${value}`;
  const advice = `try fewer edges or a different ${measure}`;
  rejectInvalid(result, before, kind, size, advice);
  rejectLooseBlend(
    made.some((face) => toleranceOf(face) > LOOSE),
    kind,
  );
  const cut =
    shellCount(result) !== shellCount(before) ||
    blendCutsThrough(new Set(made.map(shapeHash)), result);
  if (cut === false) return;
  throw new Error(
    cut
      ? `${kind} of ${size} cuts through the body: ${advice}; the previous body has been kept`
      : `${kind} of ${size} could not be checked for cutting through the body: ${advice}; the previous body has been kept`,
  );
}

function blendCutsThrough(made: Set<number>, result: Shape): boolean | null {
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

export function rejectLooseBlend(
  loose: boolean,
  kind: "fillet" | "chamfer",
): void {
  if (loose)
    throw new Error(
      `${kind} could not be built cleanly at this ${kind === "fillet" ? "radius" : "distance"}; try a smaller one`,
    );
}
