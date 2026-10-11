import type { EdgeRef, FaceRef, RefSignature } from "@rockett/shared";
import {
  acquire,
  faceCentroid,
  faces,
  getKernel,
  pnt,
  scoped,
  vec,
  type Shape,
} from "./kernel.js";
import {
  cell,
  computeEdgeNames,
  finalizeNames,
  findFace,
  geometryName,
  labelName,
  namingVersion,
  type NameMap,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { sha256 } from "../store/jsonStore.js";
import { curveInfo } from "./edgeCurve.js";
import { surfaceType } from "./tessellate.js";

type Vec = RefSignature["direction"];

function unit(x: number, y: number, z: number): Vec {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function surfaceNormal(
  face: Shape,
  surf: any,
  at: [number, number],
): { point: Vec; normal: Vec } {
  const k = getKernel();
  return scoped((own) => {
    const p = own(pnt(0, 0, 0)),
      du = own(vec(0, 0, 0)),
      dv = own(vec(0, 0, 0));
    surf.D1(...at, p, du, dv);
    const sign =
      face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const u: Vec = [du.X(), du.Y(), du.Z()];
    const v: Vec = [dv.X(), dv.Y(), dv.Z()];
    return {
      point: [p.X(), p.Y(), p.Z()],
      normal: unit(
        sign * (u[1] * v[2] - u[2] * v[1]),
        sign * (u[2] * v[0] - u[0] * v[2]),
        sign * (u[0] * v[1] - u[1] * v[0]),
      ),
    };
  });
}

export function faceSignature(face: Shape): RefSignature {
  const k = getKernel();
  return scoped((own) => {
    const surf = own(new k.BRepAdaptor_Surface_2(face, true));
    const { normal } = surfaceNormal(face, surf, [
      (surf.FirstUParameter() + surf.LastUParameter()) / 2,
      (surf.FirstVParameter() + surf.LastVParameter()) / 2,
    ]);
    return {
      type: surfaceType(surf),
      point: faceCentroid(face),
      direction: normal,
    };
  });
}

export function edgeSignature(edge: Shape): RefSignature {
  const k = getKernel();
  return scoped((own) => {
    const curve = own(new k.BRepAdaptor_Curve_2(edge));
    const p = own(pnt(0, 0, 0)),
      d = own(vec(0, 0, 0));
    curve.D1((curve.FirstParameter() + curve.LastParameter()) / 2, p, d);
    const { type } = curveInfo(edge);
    return {
      type: type === "ellipse" ? "other" : type,
      point: [p.X(), p.Y(), p.Z()],
      direction: unit(d.X(), d.Y(), d.Z()),
    };
  });
}

const finite = (sig: RefSignature) =>
  [...sig.point, ...sig.direction].every(Number.isFinite);

function faceSig(body: NamedBody, name: string): RefSignature | undefined {
  return scoped(() => {
    const face = findFace(body, name);
    if (!face) return undefined;

    return faceSignature(face);
  });
}

export function signRefs(
  bodies: ReadonlyMap<string, NamedBody>,
  refs: Array<FaceRef | EdgeRef>,
): void {
  return scoped(() => {
    const edges = new Map<string, Map<string, Shape>>();
    const edgesOf = (body: NamedBody) => {
      const known = edges.get(body.bodyId);
      if (known) return known;
      const named = computeEdgeNames(body).byName;
      edges.set(body.bodyId, named);
      return named;
    };

    for (const ref of refs) {
      const body = bodies.get(ref.bodyId);
      if (!body) continue;
      const edge = ref.kind === "edge" && edgesOf(body).get(ref.edgeName);
      const sig =
        ref.kind === "face"
          ? faceSig(body, ref.faceName)
          : edge && edgeSignature(edge);
      if (sig && finite(sig)) ref.sig = sig;
    }
  });
}

function geometryNames(shape: Shape, featureId: string): NameMap {
  return scoped(() => {
    const provisional = new ShapeMap<string>();
    acquire({ delete: () => provisional.release() });
    const shapeFaces = faces(shape);

    for (const face of shapeFaces) {
      const sig = faceSignature(face);
      const key = sha256(
        JSON.stringify([cell(sig.point), cell(sig.direction)]),
      ).slice(0, 16);
      provisional.set(face, geometryName(featureId, sig.type, key));
    }

    return finalizeNames(shape, provisional, featureId);
  });
}

export function sourceNames(
  shape: Shape,
  featureId: string,
  labels?: ShapeMap<string>,
): NameMap {
  const names =
    namingVersion() === 1
      ? finalizeNames(shape, new ShapeMap(), featureId)
      : geometryNames(shape, featureId);
  if (!labels?.size) return names;
  return scoped(() => {
    acquire({ delete: () => names.release() });
    for (const [face, label] of labels.entries())
      names.set(face, labelName(featureId, label));
    return finalizeNames(shape, names, featureId);
  });
}
