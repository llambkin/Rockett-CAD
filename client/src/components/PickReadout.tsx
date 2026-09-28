import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../store";
import { pickLabel } from "./form/fields";

export function PickReadout() {
  const hover = useStore((s) => s.hover);
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const mode = useStore((s) => s.mode);
  if (!hover && selection.length === 0) return null;
  const bodies = previewBodies({ mode, evaluation });
  const name = (pick: Selection) =>
    pickLabel(pick, document, evaluation, bodies);
  return (
    <div className="pick-readout">
      {hover && <div className="hovered">{name(hover)}</div>}
      {selection.map((pick) => (
        <div key={selectionKey(pick)}>{name(pick)}</div>
      ))}
    </div>
  );
}
