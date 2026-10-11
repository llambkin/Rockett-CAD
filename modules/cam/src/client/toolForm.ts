import { createElement as h } from "react";
import type { ClientUi, NumberFieldProps } from "@rockett/plugin-api";
import { TOOL_KINDS, withKind, type Tool } from "../shared/tools.js";

export { newTool } from "../shared/tools.js";

type Kind = Tool["kind"];
type LengthKey = "diameter" | "fluteLength" | "overallLength" | "shankDiameter";

const LENGTHS: [LengthKey, string][] = [
  ["fluteLength", "Flute length"],
  ["overallLength", "Overall length"],
  ["shankDiameter", "Shank diameter"],
];

export function toolFields(
  ui: ClientUi,
  tool: Tool,
  edit: (tool: Tool) => void,
) {
  const length = (
    key: LengthKey,
    label: string,
    bound: Pick<NumberFieldProps, "min" | "above">,
  ) =>
    h(ui.LengthField, {
      key,
      label,
      value: tool[key],
      onChange: (v) => edit({ ...tool, [key]: v }),
      ...bound,
    });
  return [
    h(ui.TextField, {
      key: "name",
      label: "Name",
      value: tool.name,
      onChange: (name) => edit({ ...tool, name }),
    }),
    h(ui.SelectField<Kind>, {
      key: "kind",
      label: "Kind",
      value: tool.kind,
      options: TOOL_KINDS,
      onChange: (kind) => edit(withKind(tool, kind)),
    }),
    length("diameter", "Diameter", { above: 0 }),
    tool.kind === "bull" &&
      h(ui.LengthField, {
        key: "cornerRadius",
        label: "Corner radius",
        value: tool.cornerRadius,
        min: 0,
        max: tool.diameter / 2,
        onChange: (cornerRadius) => edit({ ...tool, cornerRadius }),
      }),
    "tipAngle" in tool &&
      h(ui.AngleField, {
        key: "tipAngle",
        label: "Tip angle",
        value: tool.tipAngle,
        above: 0,
        max: 180,
        onChange: (tipAngle) => edit({ ...tool, tipAngle }),
      }),
    ...LENGTHS.map(([key, label]) => length(key, label, { above: 0 })),
    h(ui.NumField, {
      key: "flutes",
      label: "Flutes",
      value: tool.flutes,
      int: true,
      min: 1,
      onChange: (flutes) => edit({ ...tool, flutes }),
    }),
    h(ui.CheckField, {
      key: "centreCutting",
      label: "Centre cutting",
      value: tool.centreCutting,
      onChange: (centreCutting) => edit({ ...tool, centreCutting }),
    }),
  ];
}
