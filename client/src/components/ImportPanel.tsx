import { useStore } from "../store";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";

export function ImportPanel({
  editId,
  onClose,
}: {
  editId?: string | undefined;
  onClose: () => void;
}) {
  const feature = useStore((s) =>
    s.document?.features.find((f) => f.id === editId),
  );
  const mesh = feature?.type === "importMesh";
  return (
    <DraggablePanel title={mesh ? "Imported mesh" : "Imported STEP"}>
      <div className="dialog-body">
        <p>
          {feature?.type === "importStep" || mesh
            ? feature.filename
            : "STEP import"}
        </p>
        <p>
          Imported solid bodies are the starting geometry. Add sketches, cuts,
          fillets, and other features to modify them.
        </p>
        <p>
          {mesh
            ? "A mesh imports as flat triangular faces. It is not parametric."
            : "The originating CAD program’s sketches and feature history are not included in STEP files."}
        </p>
      </div>
      <DialogFooter onCancel={onClose} cancelLabel="Close" escapeAnywhere />
    </DraggablePanel>
  );
}
