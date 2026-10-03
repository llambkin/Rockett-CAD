import { useStore } from "../store";
import { switchWorkbench, useWorkbench, useWorkbenches } from "./workbench";

export function WorkbenchSwitcher() {
  const workbenches = useWorkbenches();
  const current = useWorkbench((s) => s.current);
  const switching = useWorkbench((s) => s.switching);
  const busy = useStore((s) => s.busy);
  if (workbenches.length < 2) return null;
  return (
    <select
      className="tb-select"
      aria-label="Workbench"
      title="Workbench"
      value={current}
      disabled={busy || switching}
      onChange={(e) =>
        void switchWorkbench(e.target.value).catch((error: Error) =>
          useStore.getState().setError(error.message),
        )
      }
    >
      {workbenches.map((workbench) => (
        <option key={workbench.id} value={workbench.id}>
          {workbench.label}
        </option>
      ))}
    </select>
  );
}
