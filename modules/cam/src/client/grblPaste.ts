import { createElement as h, Fragment, useState } from "react";
import type { ClientUi } from "@rockett/plugin-api";
import { validateMachine, type MachineProfile } from "../shared/machine.js";
import {
  MAX_SETTINGS_TEXT,
  importGrblSettings,
} from "../import/grblSettings.js";
import { banner, button, empty, reason, row, tree } from "./libraryParts.js";

type GrblPasteProps = {
  ui: ClientUi;
  machine: MachineProfile;
  edit(machine: MachineProfile): void;
};

export function GrblPaste({ ui, machine, edit }: GrblPasteProps) {
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fill = (dump: string) => {
    const refuse = (why: string) => {
      setMissing(null);
      setError(`$$ import refused: ${why}.`);
    };
    let result;
    try {
      result = importGrblSettings(dump, machine);
    } catch (e) {
      return refuse(reason(e));
    }
    const problems = validateMachine(result.machine);
    if (problems.length > 0) return refuse(problems.join("; "));
    edit(result.machine);
    setText(null);
    setError(null);
    setMissing(result.missing);
  };
  const rows = missing?.map((setting) => row({ key: setting, name: setting }));
  return h(
    Fragment,
    null,
    banner(error),
    text === null
      ? button("Import $$", "Import $$", false, () => setText(""))
      : h(
          Fragment,
          null,
          h(ui.TextAreaField, {
            label: "$$ output",
            value: text,
            maxLength: MAX_SETTINGS_TEXT,
            rows: 8,
            onChange: setText,
          }),
          button("Fill from $$", "Fill from $$", !text.trim(), () =>
            fill(text),
          ),
        ),
    rows &&
      tree(
        { title: "Missing from $$" },
        rows.length > 0 ? rows : empty("Every setting filled."),
      ),
  );
}
