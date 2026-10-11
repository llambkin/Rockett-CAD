import { useStore } from "../store";
import { NumField } from "./form/fields";

export function PolygonFields() {
  const sketch = useStore((s) =>
    s.active?.id === "design.sketch" ? s.active.state : null,
  );
  const setSketchState = useStore((s) => s.setSketchState);
  return (
    <>
      <NumField
        className="tb-input"
        title="Polygon sides"
        ariaLabel="Polygon sides"
        int
        min={3}
        max={24}
        value={sketch?.polygonSides ?? 6}
        onChange={(v) => setSketchState({ polygonSides: v })}
      />
      <select
        className="tb-select"
        title="Polygon type: Inscribed puts the vertices on the circle, Circumscribed puts the flats on it"
        aria-label="Polygon type"
        value={sketch?.polygonType ?? "inscribed"}
        onChange={(e) =>
          setSketchState({
            polygonType:
              e.target.value === "circumscribed"
                ? "circumscribed"
                : "inscribed",
          })
        }
      >
        <option value="inscribed">Inscribed</option>
        <option value="circumscribed">Circumscribed</option>
      </select>
      <NumField
        className="tb-input"
        title="Polygon angle: the first vertex's angle from sketch X in degrees. Empty follows the cursor; Shift snaps"
        ariaLabel="Polygon angle"
        label="∠"
        value={sketch?.polygonAngle ?? Number.NaN}
        onChange={(v) => setSketchState({ polygonAngle: v })}
        onClear={() => setSketchState({ polygonAngle: null })}
      />
    </>
  );
}
