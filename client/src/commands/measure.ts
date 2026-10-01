import type { MeasureResult, TopoRef } from "@rockett/shared";
import { api } from "../api";
import { useStore, type Selection } from "../store";
import type { ActiveCommand } from "./active";

export interface MeasureState {
  picks: TopoRef[];
  result: MeasureResult | null;
  pending: boolean;
}

const measurable = (s: Selection): s is TopoRef =>
  s.kind === "face" || s.kind === "edge" || s.kind === "vertex";

let unsubscribe: (() => void) | undefined;

function picksChanged(selection: Selection[]) {
  const { active } = useStore.getState();
  if (active?.id !== "inspect.measure") return;
  const picks = selection.filter(measurable).slice(0, 2);
  useStore.setState({
    selection: picks,
    active: {
      ...active,
      state: {
        picks,
        result: null,
        pending: false,
      },
    },
  });
}

async function measure() {
  const { active, document, projectId } = useStore.getState();
  if (
    active?.id !== "inspect.measure" ||
    !document ||
    active.state.picks.length === 0
  )
    return;
  const state = { ...active.state, pending: true };
  useStore.setState({ active: { ...active, state } });
  const current = () => {
    const next = useStore.getState();
    return (
      next.active?.state === state &&
      next.document === document &&
      next.projectId === projectId
    );
  };
  try {
    const result = await api.measure(document.id, state.picks);
    if (current())
      useStore.setState({
        active: { ...active, state: { ...state, result, pending: false } },
      });
  } catch (error) {
    if (current()) {
      useStore.setState({
        active: { ...active, state: { ...state, pending: false } },
        error: (error as Error).message,
      });
    }
  }
}

export const measureCommand: ActiveCommand = {
  enter() {
    const s = useStore.getState();
    s.setMode({ name: "idle" });
    const picks = s.selection.filter(measurable).slice(0, 2);
    useStore.setState({
      selection: picks,
      hover: null,
      active: {
        id: "inspect.measure",
        state: { picks, result: null, pending: false },
      },
    });
    unsubscribe = useStore.subscribe((next, previous) => {
      if (
        next.active?.id !== "inspect.measure" ||
        next.projectId !== previous.projectId ||
        next.document !== previous.document ||
        next.mode.name !== "idle"
      ) {
        measureCommand.exit();
      } else if (next.selection !== next.active.state.picks) {
        picksChanged(next.selection);
      }
    });
    void measure();
  },
  exit() {
    unsubscribe?.();
    unsubscribe = undefined;
    useStore.setState({ active: null, hover: null });
  },
  pickFilter: () => ["design.face", "design.edge", "design.vertex"],
  onHover: (selection) =>
    selection && measurable(selection) ? selection : null,
  async onClick(selection) {
    const { active } = useStore.getState();
    if (active?.id !== "inspect.measure") return;
    if (!selection) picksChanged([]);
    else if (measurable(selection)) {
      picksChanged(
        active.state.picks.length >= 2
          ? [selection]
          : [...active.state.picks, selection],
      );
      await measure();
    }
  },
  onContextMenu() {},
  hint: "Select up to two faces / edges / vertices",
  panel: "inspect.measure",
  keyContext: "inspect.measure",
};
