import { featureParams } from "../commands/featureCommand";
import { api } from "../api";
import { dialogFeatureId, useStore, type Selection } from "../store";
import type {
  FeatureFormProps,
  PickState,
  SharedInputParams,
} from "./registry";

export function TangentChainField({
  params,
  setParams,
}: FeatureFormProps<{ tangentChain?: boolean | undefined }>) {
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={params.tangentChain ?? true}
          onChange={(e) => setParams({ tangentChain: e.target.checked })}
        />{" "}
        Select tangent chain
      </label>
      <small>
        Smooth curves chain together; sharp corners stop the selection.
      </small>
    </>
  );
}

function ownsReply(s: PickState) {
  const current = useStore.getState();
  return (
    current.active?.id === "design.feature" &&
    s.active?.id === "design.feature" &&
    current.active.state.inputs.lifetime === s.active.state.inputs.lifetime &&
    current.selection === s.selection &&
    featureParams(current).tangentChain !== false
  );
}

async function pickChain(
  sel: Extract<Selection, { kind: "edge" }>,
  s: PickState,
  projectId: string,
) {
  try {
    const response = await api.tangentEdges(
      projectId,
      sel,
      dialogFeatureId(s.active),
    );
    if (!ownsReply(s)) return;
    const names = new Set(response.edges.map((e) => e.edgeName));
    const remove = response.edges.every((edge) =>
      s.selection.some(
        (selected) =>
          selected.kind === "edge" &&
          selected.bodyId === edge.bodyId &&
          selected.edgeName === edge.edgeName,
      ),
    );
    const remaining = s.selection.filter(
      (selected) =>
        selected.kind !== "edge" ||
        selected.bodyId !== sel.bodyId ||
        !names.has(selected.edgeName),
    );
    s.setSelection(remove ? remaining : [...remaining, ...response.edges]);
  } catch (error) {
    if (ownsReply(s))
      s.setError(error instanceof Error ? error.message : String(error));
  }
}

export function tangentChain(
  sel: Selection,
  s: PickState,
  params: SharedInputParams = featureParams(s),
): Promise<void> | undefined {
  if (sel.kind !== "edge" || params.tangentChain === false) return;
  return s.projectId ? pickChain(sel, s, s.projectId) : undefined;
}
