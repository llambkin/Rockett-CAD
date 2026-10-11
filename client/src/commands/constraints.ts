import type { Command, CommandContext } from "./registry";
import { tooltipOf } from "./keymap";
import { deleteSketchSelection } from "./sketch";
import {
  CONSTRAINTS,
  addSketchConstraints,
  constraintFor,
  sketchSelectionIds,
  splineRefusal,
  type RelationType,
} from "../sketchRelations";

const chosen = (s: CommandContext, type: RelationType) =>
  s.active?.id === "design.sketch" && s.draftSketch
    ? constraintFor(s.draftSketch, sketchSelectionIds(s.selection), type)
    : null;

export const constraintCommands: Command[] = [
  ...CONSTRAINTS.map(({ type, label, title }): Command => ({
    id: `design.sketch.${type}`,
    label,
    icon: type,
    group: "design.sketch.group.constrain",
    tooltip: title,
    iconOnly: true,
    explainsRefusal: true,
    enabled: (s) =>
      !!chosen(s, type) ||
      (!!s.draftSketch &&
        splineRefusal(s.draftSketch, sketchSelectionIds(s.selection))) ||
      `Selection doesn't match the ${type} constraint: check the tooltip`,
    run: (s) => {
      const c = chosen(s, type);
      if (c) return addSketchConstraints([c]);
    },
  })),
  {
    id: "design.sketch.deleteSelected",
    label: "Delete",
    icon: "delete",
    group: "design.sketch.group.constrain",
    get tooltip() {
      return tooltipOf({
        id: "design.sketch.delete",
        label: "Delete selected",
      });
    },
    run: deleteSketchSelection,
  },
];
