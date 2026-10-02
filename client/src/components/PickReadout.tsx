import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../store";
import { pickLabel } from "./form/fields";
import { useSelectionMeasures } from "./selectionMeasure";

export function PickReadout() {
  const hover = useStore((s) => s.hover);
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const active = useStore((s) => s.active);
  const measures = useSelectionMeasures();
  if (!hover && selection.length === 0) return null;
  const bodies = previewBodies({ active, evaluation });
  const name = (pick: Selection) =>
    pickLabel(pick, document, evaluation, bodies);
  return (
    <div className="pick-readout">
      {hover && <div className="hovered">{name(hover)}</div>}
      {selection.map((pick) => (
        <div key={selectionKey(pick)}>{name(pick)}</div>
      ))}
      {measures.map((text) => (
        <div key={text} className="measured">
          {text}
        </div>
      ))}
    </div>
  );
}
