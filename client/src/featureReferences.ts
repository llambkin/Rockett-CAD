import { featureParams, setFeatureParams } from "./commands/featureCommand";
import {
  ROUTES,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type RefCandidate,
} from "@rockett/shared";
import { send } from "./api";
import { useStore, type Selection } from "./store";
import { dialogTargets } from "./toolTargets";
import { loadPreviewBase } from "./previewBase";

type Ref = FaceRef | EdgeRef;

export const pickOf = (
  kind: Ref["kind"],
  { bodyId, name }: Pick<RefCandidate, "bodyId" | "name">,
): Ref =>
  kind === "face"
    ? { kind, bodyId, faceName: name }
    : { kind, bodyId, edgeName: name };

const sameRef = (item: Record<string, unknown>, ref: Ref) =>
  item.kind === ref.kind &&
  item.bodyId === ref.bodyId &&
  (ref.kind === "face"
    ? item.faceName === ref.faceName
    : item.edgeName === ref.edgeName);

function swapRef(value: unknown, ref: Ref, to: Ref): unknown {
  if (Array.isArray(value)) return value.map((v) => swapRef(v, ref, to));
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  if (sameRef(item, ref)) return to;
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, swapRef(v, ref, to)]),
  );
}

const editing = (projectId: string | null, fid: string) => {
  const s = useStore.getState();
  return s.projectId === projectId &&
    s.active?.id === "design.feature" &&
    s.active.state.editFeatureId === fid
    ? s
    : null;
};

async function signed(id: string, fid: string, to: Ref) {
  try {
    const { sig } = await send(
      ROUTES.refSignature,
      { id, fid },
      { body: { ref: to } },
    );
    return { ...to, sig };
  } catch (e) {
    if (editing(id, fid)) useStore.getState().setError((e as Error).message);
    return null;
  }
}

let signing = false;

export async function accept(fid: string, ref: Ref, to: Ref): Promise<void> {
  const { projectId, document } = useStore.getState();
  if (!projectId || !document || signing) return;
  signing = true;
  const fresh = await signed(projectId, fid, to).finally(() => {
    signing = false;
  });
  const s = editing(projectId, fid);
  if (!fresh || s?.document?.revision !== document.revision) return;
  const feature = s.document.features.find((f) => f.id === fid);
  if (!feature) return;
  const patch = Object.fromEntries(
    Object.entries(feature).flatMap(([key, value]) => {
      const next = swapRef(value, ref, fresh);
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
  const current = editing(projectId, fid);
  if (!current) return;
  useStore.setState({
    selection: current.selection.map(
      (pick) => swapRef(pick, ref, to) as Selection,
    ),
    hover: null,
  });
  setFeatureParams(
    swapRef(featureParams(current), ref, to) as ReturnType<
      typeof featureParams
    >,
  );
  await loadPreviewBase(fid, useStore.getState);
}

export function repick(pick: Selection | null): boolean {
  const s = useStore.getState();
  const ref: Ref | undefined = featureParams(s).repick;
  const fid =
    s.active?.id === "design.feature"
      ? s.active.state.editFeatureId
      : undefined;
  if (!ref || !fid) return false;
  if (pick?.kind !== ref.kind || s.busy || signing) return true;
  setFeatureParams({ repick: undefined });
  const name = pick.kind === "face" ? pick.faceName : pick.edgeName;
  void accept(fid, ref, pickOf(ref.kind, { bodyId: pick.bodyId, name }));
  return true;
}
