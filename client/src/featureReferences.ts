import type { EdgeRef, FaceRef, Feature, RefCandidate } from "@rockett/shared";
import { useStore, type Selection } from "./store";
import { dialogTargets } from "./toolTargets";
import { loadPreviewBase } from "./previewBase";

type Ref = FaceRef | EdgeRef;

export const pickOf = (
  kind: Ref["kind"],
  { bodyId, name }: Pick<RefCandidate, "bodyId" | "name">,
): Selection =>
  kind === "face"
    ? { kind, bodyId, faceName: name }
    : { kind, bodyId, edgeName: name };

const sameRef = (item: Record<string, unknown>, ref: Ref) =>
  item.kind === ref.kind &&
  item.bodyId === ref.bodyId &&
  (ref.kind === "face"
    ? item.faceName === ref.faceName
    : item.edgeName === ref.edgeName);

function swapRef(value: unknown, ref: Ref, to: Selection): unknown {
  if (Array.isArray(value)) return value.map((v) => swapRef(v, ref, to));
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  if (sameRef(item, ref)) return to;
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, swapRef(v, ref, to)]),
  );
}

export async function accept(
  fid: string,
  ref: Ref,
  to: Selection,
): Promise<void> {
  const s = useStore.getState();
  const feature = s.document?.features.find((f) => f.id === fid);
  if (!feature) return;
  const patch = Object.fromEntries(
    Object.entries(feature).flatMap(([key, value]) => {
      const next = swapRef(value, ref, to);
      return JSON.stringify(next) === JSON.stringify(value)
        ? []
        : [[key, next]];
    }),
  );
  try {
    await s.updateFeature(fid, {
      ...patch,
      ...dialogTargets(),
    } as Partial<Feature>);
  } catch {
    return;
  }
  const current = useStore.getState();
  if (
    current.projectId !== s.projectId ||
    current.active?.id !== "design.feature" ||
    current.active.state.editFeatureId !== fid
  )
    return;
  useStore.setState({
    selection: current.selection.map(
      (pick) => swapRef(pick, ref, to) as Selection,
    ),
    dialogParams: swapRef(
      current.dialogParams,
      ref,
      to,
    ) as typeof current.dialogParams,
    hover: null,
  });
  await loadPreviewBase(fid, useStore.getState);
}

export function repick(pick: Selection | null): boolean {
  const s = useStore.getState();
  const ref: Ref | undefined = s.dialogParams.repick;
  const fid =
    s.active?.id === "design.feature"
      ? s.active.state.editFeatureId
      : undefined;
  if (!ref || !fid) return false;
  if (pick?.kind !== ref.kind) return true;
  s.setDialogParams({ repick: undefined });
  const name = pick.kind === "face" ? pick.faceName : pick.edgeName;
  void accept(fid, ref, pickOf(ref.kind, { bodyId: pick.bodyId, name }));
  return true;
}
