import type {
  AxisRef,
  OriginAxis,
  CadDocument,
  EdgeRef,
  FaceRef,
  LinearPatternFeature,
  PlaneRef,
  ProfileRef,
} from "@rockett/shared";
import { useStore, type Selection } from "../store";
import { fromRef, refsOf, toRef } from "../selection/kinds";
import { toolTargets } from "../toolTargets";
import type { SharedInputParams } from "./registry";

export const profileHint = "click sketch regions or Shift-click planar faces";

export { num } from "./registry";

export const profileRefs = (selection: Selection[]): ProfileRef[] =>
  refsOf(selection, "profile");

export const profilePicks = (refs: ProfileRef[]): Selection[] =>
  refs.map((ref) => fromRef("profile", ref));

export const edgeRefs = (selection: Selection[]): EdgeRef[] =>
  refsOf(selection, "edge");

export const edgePicks = (edges: EdgeRef[]): Selection[] =>
  edges.map((ref) => fromRef("edge", ref));

export const faceRefs = (selection: Selection[]): FaceRef[] =>
  refsOf(selection, "face");

export const facePicks = (faces: FaceRef[]): Selection[] =>
  faces.map((ref) => fromRef("face", ref));

export const storedFeature = (id: string | undefined): object =>
  useStore.getState().document?.features.find((f) => f.id === id) ?? {};

export const keptRefs = <K extends string, T>(
  key: K,
  refs: T[],
  stored: object,
) => (refs.length > 0 || key in stored) && ({ [key]: refs } as Record<K, T[]>);

export function profileSources(
  selection: Selection[],
  stored: object,
): { error: string } | { profiles: ProfileRef[]; faces?: FaceRef[] } {
  const profiles = profileRefs(selection);
  const faces = faceRefs(selection);
  if (profiles.length + faces.length === 0)
    return { error: "Select at least one profile or planar face" };
  return {
    profiles,
    ...keptRefs("faces", faces, stored),
  };
}

export const bodyIds = (selection: Selection[]): string[] =>
  refsOf(selection, "body");

export const bodyPicks = (ids: string[]): Selection[] =>
  ids.map((ref) => fromRef("body", ref));

export const bodyTargets = (
  operation: string,
  params: Pick<SharedInputParams, "id" | "targets">,
) =>
  toolTargets(operation, params, useStore.getState().document?.namingVersion);

export const selectedPlane = (selection: Selection[]): PlaneRef | null => {
  const plane = selection.find((x) => x.kind === "plane");
  if (plane) return toRef(plane);
  const face = selection.find((x) => x.kind === "face");
  return face
    ? {
        kind: "face",
        face: toRef(face),
      }
    : null;
};

type Doc = CadDocument | null | undefined;

const sketchLines = (selection: Selection[], document: Doc) =>
  selection.flatMap((x) => {
    if (x.kind !== "sketchEntity") return [];
    const sketch = document?.features.find((f) => f.id === x.sketchId);
    return sketch?.type === "sketch" &&
      sketch.entities.find((e) => e.id === x.entityId)?.kind === "line"
      ? [x]
      : [];
  });

export const axisPicks = (selection: Selection[], document: Doc) => [
  ...selection.filter((x) => x.kind === "edge"),
  ...sketchLines(selection, document),
];

export const axisMissing = (
  params: AxisParams,
  selection: Selection[],
  document: Doc,
) =>
  params.axisSource === "edge" && axisPicks(selection, document).length === 0;

export const axisHint = (missing: boolean) =>
  missing ? "Pick an axis" : "click a sketch line or body edge, or pick X/Y/Z";

export function axisRef(
  params: AxisParams,
  selection: Selection[],
  document: Doc,
): AxisRef | null {
  if ((params.axisSource ?? "origin") !== "edge")
    return { kind: "originAxis", axis: params.axis ?? "Z" };
  const line = sketchLines(selection, document)[0];
  if (line) {
    const { sketchId, entityId } = toRef(line);
    return { kind: "sketchLine", sketchId, entityId };
  }
  const edge = selection.find((x) => x.kind === "edge");
  return edge
    ? {
        kind: "edge",
        edge: toRef(edge),
      }
    : null;
}

export type AxisParams = Pick<SharedInputParams, "axis" | "axisSource">;

type AxisChoice = AxisRef | LinearPatternFeature["direction"];

export const axisParams = (
  axis: AxisChoice | undefined,
  defaultAxis: OriginAxis = "Z",
): AxisParams =>
  axis?.kind === "originAxis" || axis?.kind === "axis"
    ? { axisSource: "origin", axis: axis.axis }
    : { axisSource: "edge", axis: defaultAxis };

export const axisSelection = (axis: AxisChoice): Selection[] => {
  if (axis.kind === "edge") return [fromRef("edge", axis.edge)];
  if (axis.kind === "sketchLine")
    return [
      fromRef("sketchEntity", {
        sketchId: axis.sketchId,
        entityId: axis.entityId,
      }),
    ];
  return [];
};
