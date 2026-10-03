import { formatAngle, formatLength, UNIT_TO_MM } from "@rockett/shared";
import { useSetting } from "../settings";
import { exitActive } from "../commands/active";
import { useStore } from "../store";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";

export function MeasurePanel() {
  const units = useSetting("units.length");
  const state = useStore((s) =>
    s.active?.id === "inspect.measure" ? s.active.state : undefined,
  );
  const result = state?.result;
  const selection = state?.picks ?? [];
  const fmt = (v: number | undefined) =>
    v === undefined ? "-" : formatLength(v, units);

  return (
    <DraggablePanel title="Measure" className="measure">
      <div className="dialog-body">
        {selection.length === 0 && (
          <div className="sel-info">
            <span>Select</span>
            <b>faces, edges or vertices (max 2)</b>
          </div>
        )}
        {result?.items.map((item, i) => (
          <div key={i} className="measure-block">
            <div className="measure-head">
              Selection {i + 1}: {item.kind}
            </div>
            {item.length !== undefined && (
              <Row k="Length" v={fmt(item.length)} />
            )}
            {item.area !== undefined && (
              <Row
                k="Area"
                v={`${formatLength(item.area / UNIT_TO_MM[units], units)}²`}
              />
            )}
            {item.radius !== undefined && (
              <Row k="Radius" v={fmt(item.radius)} />
            )}
            {item.diameter !== undefined && (
              <Row k="Diameter" v={fmt(item.diameter)} />
            )}
            {item.position && (
              <Row
                k="Position"
                v={item.position.map((x) => fmt(x)).join(", ")}
              />
            )}
          </div>
        ))}
        {result?.distance !== undefined && (
          <div className="measure-block main">
            <Row k="Distance" v={fmt(result.distance)} />
            <Row k="ΔX" v={fmt(result.deltaX)} />
            <Row k="ΔY" v={fmt(result.deltaY)} />
            <Row k="ΔZ" v={fmt(result.deltaZ)} />
            {result.angleDeg !== undefined && (
              <Row k="Angle" v={formatAngle(result.angleDeg, 4)} />
            )}
          </div>
        )}
      </div>
      <DialogFooter onCancel={exitActive} cancelLabel="Done" />
    </DraggablePanel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="measure-row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
