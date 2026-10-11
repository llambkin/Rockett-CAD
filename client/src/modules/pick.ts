import type { Dispose, PickMode } from "@rockett/plugin-api";
import { registerCommand } from "../commands/registry";
import { measureRef } from "../components/selectionMeasure";
import { useStore, type Selection } from "../store";

const PICK = "module.pick";

const picking = () => {
  const { active } = useStore.getState();
  return active?.id === PICK ? active.state : undefined;
};

const pickable = (selection: Selection | null) => {
  const ref = selection && measureRef(selection);
  return ref && picking()?.kinds.includes(ref.kind) ? ref : undefined;
};

registerCommand({
  id: PICK,
  label: "Pick",
  interaction: {
    enter() {},
    exit: () => useStore.setState({ active: null, hover: null }),
    pickFilter: () => (picking()?.kinds ?? []).map((kind) => `design.${kind}`),
    onHover: (selection) => (pickable(selection) ? selection : null),
    async onClick(selection) {
      const ref = selection ? pickable(selection) : null;
      if (ref !== undefined) picking()?.onPick(ref);
    },
    onContextMenu() {},
    get hint() {
      return picking()?.hint ?? "";
    },
    get keyContext() {
      return picking()?.command ?? PICK;
    },
  },
  run() {},
});

export function pickMode(
  moduleId: string,
  mode: PickMode,
  ended: Dispose,
): Dispose {
  if (!mode.command.startsWith(`${moduleId}.`))
    throw new Error(`${mode.command} is not a command of ${moduleId}`);
  useStore.getState().clearActive();
  const { projectId, document } = useStore.getState();
  useStore.setState({ active: { id: PICK, state: mode }, hover: null });
  let live = true;
  const end = () => {
    if (!live) return;
    live = false;
    stop();
    ended();
    if (picking() === mode) useStore.setState({ active: null, hover: null });
    mode.onEnd?.();
  };
  const stop = useStore.subscribe((now) => {
    if (
      now.active?.state !== mode ||
      now.projectId !== projectId ||
      now.document !== document
    )
      end();
  });
  return end;
}
