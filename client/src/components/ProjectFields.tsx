import { useStore } from "../store";
import type { ProjectPick } from "../commands/sketch";

const OPTIONS: [ProjectPick, string][] = [
  ["entities", "Edges and faces"],
  ["bodies", "Bodies"],
  ["faceSections", "Face sections"],
  ["bodySections", "Body sections"],
];

export function ProjectFields() {
  const pick = useStore((s) =>
    s.active?.id === "design.sketch" ? s.active.state.projectPick : "entities",
  );
  const setSketchState = useStore((s) => s.setSketchState);
  return (
    <select
      className="tb-select"
      title="Project selection: edges, faces and sketch curves; whole bodies as their outline; or faces and bodies cut where they cross the sketch plane"
      aria-label="Project selection"
      value={pick}
      onChange={(e) =>
        setSketchState({ projectPick: OPTIONS[e.target.selectedIndex]![0] })
      }
    >
      {OPTIONS.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
