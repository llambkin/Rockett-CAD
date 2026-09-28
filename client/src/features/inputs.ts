import type {
  AxisRef,
  CadDocument,
  EdgeRef,
  PlaneRef,
  ProfileRef,
} from "@rockett/shared";
import { useStore, type Selection } from "../store";
import { HANDLE_VALUES, type HandleDialog } from "../three/featureHandles";
import { toolTargets } from "../toolTargets";
import type { DialogParams } from "./registry";

export const num = (params: DialogParams, key: string, dflt: number) => {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : dflt;
};

export const handleValue = (params: DialogParams, d: HandleDialog) =>
  num(params, HANDLE_VALUES[d].param, HANDLE_VALUES[d].fallback);

export const profileRefs = (selection: Selection[]): ProfileRef[] =>
  selection.flatMap((x) =>
    x.kind === "profile"
      ? [{ sketchId: x.sketchId, profileId: x.profileId }]
      : [],
  );

export const profilePicks = (refs: ProfileRef[]): Selection[] =>
  refs.map((r) => ({
    kind: "profile",
    sketchId: r.sketchId,
    profileId: r.profileId,
  }));

export const edgeRefs = (selection: Selection[]): EdgeRef[] =>
  selection.flatMap((x) =>
    x.kind === "edge"
      ? [{ kind: "edge", bodyId: x.bodyId, edgeName: x.edgeName }]
      : [],
  );

export const edgePicks = (edges: EdgeRef[]): Selection[] =>
  edges.map((x) => ({ kind: "edge", bodyId: x.bodyId, edgeName: x.edgeName }));

export const bodyTargets = (operation: string, params: DialogParams) =>
  toolTargets(
    operation,
    params.targets,
    useStore.getState().document?.namingVersion,
  );

export const selectedPlane = (selection: Selection[]): PlaneRef | null => {
  const plane = selection.find((x) => x.kind === "plane");
  if (plane) return plane.ref;
  const face = selection.find((x) => x.kind === "face");
  return face
    ? {
        kind: "face",
        face: { kind: "face", bodyId: face.bodyId, faceName: face.faceName },
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
  params: DialogParams,
  selection: Selection[],
  document: Doc,
) =>
  params.axisSource === "edge" && axisPicks(selection, document).length === 0;

export function axisRef(
  params: DialogParams,
  selection: Selection[],
  document: Doc,
): AxisRef | null {
  if ((params.axisSource ?? "origin") !== "edge")
    return { kind: "originAxis", axis: params.axis ?? "Z" };
  const line = sketchLines(selection, document)[0];
  if (line)
    return {
      kind: "sketchLine",
      sketchId: line.sketchId,
      entityId: line.entityId,
    };
  const edge = selection.find((x) => x.kind === "edge");
  return edge
    ? {
        kind: "edge",
        edge: { kind: "edge", bodyId: edge.bodyId, edgeName: edge.edgeName },
      }
    : null;
}

export const axisParams = (axis: AxisRef | undefined) => ({
  axisSource: axis?.kind === "originAxis" ? "origin" : "edge",
  axis: axis?.kind === "originAxis" ? axis.axis : "Z",
});

export const axisSelection = (axis: AxisRef): Selection[] => {
  if (axis.kind === "edge")
    return [
      { kind: "edge", bodyId: axis.edge.bodyId, edgeName: axis.edge.edgeName },
    ];
  if (axis.kind === "sketchLine")
    return [
      {
        kind: "sketchEntity",
        sketchId: axis.sketchId,
        entityId: axis.entityId,
      },
    ];
  return [];
};
