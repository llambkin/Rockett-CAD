import {
  compareNames,
  faceMadeBy,
  type ChamferFeature,
  type EdgeRef,
  type FaceRef,
  type FilletFeature,
} from "@rockett/shared";
import type { EvalState } from "./featureState.js";
import { faceNamesOf, type NamedBody } from "./naming.js";
import { sharpEdgesByFace } from "./tangentEdges.js";

const edgeRefs = (bodyId: string, names: string[]): EdgeRef[] =>
  names.map((edgeName) => ({ kind: "edge", bodyId, edgeName }));

type Picks = Pick<
  FilletFeature | ChamferFeature,
  "type" | "edges" | "faces" | "features"
> &
  Pick<FilletFeature, "betweenFaces" | "betweenFeatures">;

const picksFace =
  (bodyId: string, faces: FaceRef[] = [], features: string[] = []) =>
  (face: string) =>
    faces.some((ref) => ref.bodyId === bodyId && ref.faceName === face) ||
    features.some((id) => faceMadeBy(id, face));

export function blendEdges(state: EvalState, f: Picks): EdgeRef[] {
  const ruled = !!(f.betweenFaces?.length || f.betweenFeatures?.length);
  if (!f.faces?.length && !f.features?.length) {
    if (ruled)
      throw new Error("a rule fillet needs a face or a feature to round from");
    if (f.edges.length === 0) throw new Error("no edges selected");
    return f.edges;
  }
  const label = f.type === "fillet" ? "Fillet" : "Chamfer";
  const sharp = new Map<string, Map<string, string[]>>();
  const sharpOf = (body: NamedBody) => {
    const found = sharp.get(body.bodyId) ?? sharpEdgesByFace(body);
    sharp.set(body.bodyId, found);
    return found;
  };
  const derived: EdgeRef[] = [];
  for (const { bodyId, faceName } of f.faces ?? []) {
    const body = state.bodies.get(bodyId);
    if (!body) throw new Error(`body ${bodyId} no longer exists`);
    const names = sharpOf(body).get(faceName);
    if (!names)
      throw new Error(`referenced face no longer exists: ${faceName}`);
    if (names.length === 0)
      throw new Error(`${label} found no sharp edges on face ${faceName}`);
    derived.push(...edgeRefs(bodyId, names));
  }
  for (const id of f.features ?? []) {
    const made = [...state.bodies.values()]
      .filter((body) =>
        (body.mesh?.names ?? faceNamesOf(body)).some((face) =>
          faceMadeBy(id, face),
        ),
      )
      .flatMap((body) => {
        const names = [...sharpOf(body)]
          .filter(([face]) => faceMadeBy(id, face))
          .flatMap(([, edges]) => edges);
        return edgeRefs(body.bodyId, names.toSorted(compareNames));
      });
    if (made.length === 0)
      throw new Error(
        `${label} found no sharp edges on the faces of feature ${id}`,
      );
    derived.push(...made);
  }
  const between = ({ bodyId, edgeName }: EdgeRef) => {
    const inA = picksFace(bodyId, f.faces, f.features);
    const inB = picksFace(bodyId, f.betweenFaces, f.betweenFeatures);
    const [a = "", b = ""] = [...sharpOf(state.bodies.get(bodyId)!)]
      .filter(([, edges]) => edges.includes(edgeName))
      .map(([face]) => face);
    return (inA(a) && inB(b)) || (inA(b) && inB(a));
  };
  const rounded = ruled ? derived.filter(between) : derived;
  if (ruled && rounded.length === 0)
    throw new Error(`${label} found no sharp edges between the picked faces`);
  const picked = [...f.edges, ...rounded];
  const seen = new Set<string>();
  return picked.filter(({ bodyId, edgeName }) => {
    const key = `${bodyId}\n${edgeName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
