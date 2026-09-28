import { api } from "../api";
import { dialogFeatureId, useStore, type Selection } from "../store";
import type { FeatureFormProps, PickState } from "./registry";

export function TangentChainField({ params, setParams }: FeatureFormProps) {
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

async function pickChain(
  sel: Extract<Selection, { kind: "edge" }>,
  s: PickState,
  projectId: string,
) {
  try {
    const response = await api.tangentEdges(
      projectId,
      sel,
      dialogFeatureId(s.mode),
    );
    const current = useStore.getState();
    if (
      current.mode !== s.mode ||
      current.selection !== s.selection ||
      current.dialogParams.tangentChain === false
    )
      return;
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
    s.setError((error as Error).message);
  }
}

export function tangentChain(
  sel: Selection,
  s: PickState,
): Promise<void> | undefined {
  if (sel.kind !== "edge" || s.dialogParams.tangentChain === false) return;
  return s.projectId ? pickChain(sel, s, s.projectId) : undefined;
}
