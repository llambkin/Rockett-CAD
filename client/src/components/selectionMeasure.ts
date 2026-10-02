import {
  formatAngle,
  formatLength,
  type BodyPayload,
  type CadDocument,
  type MeasureResult,
  type SketchEntity,
  type TopoRef,
  type Units,
} from "@rockett/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { measurable } from "../commands/measure";
import { previewBodies } from "../previewBase";
import { useSetting } from "../settings";
import { dimensionFor, measureDimension, type DimTarget } from "../sketchTools";
import { useStore, type Selection } from "../store";
import { TIMING_MS } from "../tunables";

interface Scene {
  bodies: BodyPayload[];
  sketch: (sketchId: string) => SketchEntity[] | undefined;
}

interface Pair {
  distance?: number | undefined;
  angleDeg?: number | undefined;
}

type Outcome = { result: MeasureResult } | { error: string };

interface SketchPick {
  sketchId: string;
  entities: SketchEntity[];
  target: DimTarget;
}

function sketchPick(pick: Selection, scene: Scene): SketchPick | undefined {
  if (pick.kind !== "sketchEntity" && pick.kind !== "sketchPoint") return;
  const entities = scene.sketch(pick.sketchId);
  const kind = entities?.find((e) => e.id === pick.entityId)?.kind;
  if (!entities || (kind !== "point" && kind !== "line")) return;
  return {
    sketchId: pick.sketchId,
    entities,
    target: { kind, id: pick.entityId },
  };
}

function lengthOf(pick: Selection, scene: Scene): number | undefined {
  if (pick.kind === "edge")
    return scene.bodies
      .find((b) => b.bodyId === pick.bodyId)
      ?.edges.find((e) => e.name === pick.edgeName)?.length;
  const sketch = sketchPick(pick, scene);
  if (sketch?.target.kind !== "line") return;
  return measureDimension(
    { id: "", type: "length", line: sketch.target.id, value: 0 },
    sketch.entities,
  );
}

function sizeOf(selection: Selection[], scene: Scene): number[] | undefined {
  const boxes = selection.flatMap((pick) =>
    pick.kind === "body"
      ? scene.bodies.filter((b) => b.bodyId === pick.bodyId).map((b) => b.bbox)
      : [],
  );
  if (boxes.length === 0) return;
  return [0, 1, 2].map(
    (i) =>
      Math.max(...boxes.map((b) => b.max[i]!)) -
      Math.min(...boxes.map((b) => b.min[i]!)),
  );
}

function sketchPair(selection: Selection[], scene: Scene): Pair | undefined {
  const [a, b] = selection.map((pick) => sketchPick(pick, scene));
  if (!a || !b || a.sketchId !== b.sketchId) return;
  const dimension = dimensionFor([a.target, b.target], a.entities);
  if (!dimension || !("value" in dimension)) return;
  if (dimension.type === "angle")
    return { angleDeg: Math.min(dimension.value, 180 - dimension.value) };
  if (dimension.type === "lineDistance")
    return { distance: dimension.value, angleDeg: 0 };
  return { distance: dimension.value };
}

function pairLines(pair: Pair, units: Units): string[] {
  return [
    ...(pair.distance === undefined
      ? []
      : [`Distance ${formatLength(pair.distance, units)}`]),
    ...(pair.angleDeg === undefined
      ? []
      : [`Angle ${formatAngle(pair.angleDeg, 4)}`]),
  ];
}

function useExactPair(
  projectId: string | null,
  refs: TopoRef[] | null,
  document: CadDocument | null,
  bodies: BodyPayload[],
): Outcome | "pending" | null {
  const [reply, setReply] = useState<{
    key: string;
    projectId: string;
    document: CadDocument | null;
    bodies: BodyPayload[];
    outcome: Outcome;
  } | null>(null);
  const key = projectId && refs ? JSON.stringify(refs) : null;
  const held =
    reply?.key === key &&
    reply.projectId === projectId &&
    reply.document === document &&
    reply.bodies === bodies
      ? reply.outcome
      : null;
  useEffect(() => {
    if (!projectId || !refs || !key || held) return;
    let live = true;
    const land = (outcome: Outcome) => {
      if (live) setReply({ key, projectId, document, bodies, outcome });
    };
    const timer = setTimeout(() => {
      api.measure(projectId, refs).then(
        (result) => land({ result }),
        (error) => land({ error: (error as Error).message }),
      );
    }, TIMING_MS.selectionSettle);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, projectId, document, bodies]);
  return key ? (held ?? "pending") : null;
}

export function useSelectionMeasures(): string[] {
  const units = useSetting("units.length");
  const selection = useStore((s) => s.selection);
  const projectId = useStore((s) => s.projectId);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const active = useStore((s) => s.active);
  const draft = useStore((s) => s.draftSketch);
  const bodies = previewBodies({ active, evaluation });
  const scene: Scene = {
    bodies,
    sketch: (id) =>
      draft?.id === id
        ? draft.entities
        : evaluation?.sketches.find((s) => s.featureId === id)?.entities,
  };
  const refs =
    selection.length === 2 &&
    selection.every(measurable) &&
    bodies === evaluation?.bodies &&
    active?.id !== "inspect.measure"
      ? selection
      : null;
  const exact = useExactPair(projectId, refs, document, bodies);

  const lines: string[] = [];
  const lengths = selection.flatMap((pick) => lengthOf(pick, scene) ?? []);
  if (lengths.length > 0)
    lines.push(
      `${lengths.length > 1 ? "Total length" : "Length"} ${formatLength(
        lengths.reduce((sum, v) => sum + v, 0),
        units,
      )}`,
    );
  const size = sizeOf(selection, scene);
  if (size)
    lines.push(
      `Size ${size.map((v, i) => `${"XYZ"[i]} ${formatLength(v, units)}`).join(", ")}`,
    );
  if (exact === "pending") lines.push("Measuring");
  else if (exact && "error" in exact)
    lines.push(`Measure failed: ${exact.error}`);
  else if (exact) lines.push(...pairLines(exact.result, units));
  else if (selection.length === 2) {
    const pair = sketchPair(selection, scene);
    if (pair) lines.push(...pairLines(pair, units));
  }
  return lines;
}
