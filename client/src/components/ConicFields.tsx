import { DEFAULT_RHO } from "../commands/sketch";
import { selectedConic, setConicRho } from "../splineTools";
import { useStore } from "../store";
import { NumField } from "./form/fields";

export function ConicFields() {
  const conic = useStore(selectedConic);
  const rho = useStore((s) =>
    s.active?.id === "design.sketch" ? s.active.state.conicRho : DEFAULT_RHO,
  );
  const setSketchState = useStore((s) => s.setSketchState);
  return (
    <NumField
      className="tb-input"
      title="Conic rho: how far the curve bulges toward its apex. Below 0.5 is elliptical, 0.5 parabolic, above 0.5 hyperbolic"
      ariaLabel="Conic rho"
      label="ρ"
      above={0}
      below={1}
      value={conic?.rho ?? rho}
      onChange={(v) =>
        conic ? void setConicRho(conic.id, v) : setSketchState({ conicRho: v })
      }
    />
  );
}
