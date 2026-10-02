import { useStore } from "../store";
import { NumField } from "./form/fields";

export function PolygonFields() {
  const active = useStore((s) => s.active);
  const setSketchState = useStore((s) => s.setSketchState);
  const dialogParams = useStore((s) => s.dialogParams);
  const setDialogParams = useStore((s) => s.setDialogParams);
  return (
    <>
      <NumField
        className="tb-input"
        title="Polygon sides"
        ariaLabel="Polygon sides"
        int
        min={3}
        max={24}
        value={active?.id === "design.sketch" ? active.state.polygonSides : 6}
        onChange={(v) => setSketchState({ polygonSides: v })}
      />
      <select
        className="tb-select"
        title="Polygon type: Inscribed puts the vertices on the circle, Circumscribed puts the flats on it"
        aria-label="Polygon type"
        value={dialogParams.polygonType ?? "inscribed"}
        onChange={(e) => setDialogParams({ polygonType: e.target.value })}
      >
        <option value="inscribed">Inscribed</option>
        <option value="circumscribed">Circumscribed</option>
      </select>
      <NumField
        className="tb-input"
        title="Polygon angle: the first vertex's angle from sketch X in degrees. Empty follows the cursor; Shift snaps"
        ariaLabel="Polygon angle"
        label="∠"
        value={dialogParams.polygonAngle ?? Number.NaN}
        onChange={(v) => setDialogParams({ polygonAngle: v })}
        onClear={() => setDialogParams({ polygonAngle: undefined })}
      />
    </>
  );
}
