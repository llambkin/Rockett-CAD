import { NAMED_VIEWS } from "../three/camera";
import { viewportHandle } from "../viewportRef";

export function NamedViewSelect() {
  return (
    <select
      className="tb-select"
      title="Named views"
      value=""
      onChange={(e) => {
        const v = NAMED_VIEWS.find((x) => x.label === e.target.value);
        if (v) viewportHandle.current?.setView(v.dir, v.up);
      }}
    >
      <option value="" disabled>
        View
      </option>
      {NAMED_VIEWS.map((v) => (
        <option key={v.label}>{v.label}</option>
      ))}
    </select>
  );
}
