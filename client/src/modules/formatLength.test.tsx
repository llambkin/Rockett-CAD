import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { defineClientModule, type ClientUi } from "@rockett/plugin-api";
import { formatLength, type Units } from "@rockett/shared";
import { useSettings } from "../settings";
import { loadClientModules } from "./host";

const values = [0, 1, 12.7, 25.4, 1234.56789, -3.3];
let ui: ClientUi;
let unload = () => {};

afterEach(() => unload());

const useUnits = (units: Units) =>
  useSettings.setState((s) => ({
    resolved: {
      ...s.resolved,
      "units.length": { value: units, source: "user" },
    },
  }));

function Lengths() {
  const format = ui.useFormatLength();
  return values.map((v) => `${format(v)}|${format(v * 25.4, 2)}`).join(";");
}

const core = (units: Units) =>
  values
    .map(
      (v) =>
        `${formatLength(v, units)}|${formatLength((v * 25.4) / (units === "in" ? 25.4 : 1), units)}²`,
    )
    .join(";");

it("formats lengths and areas like core formatLength in the user's units", async () => {
  unload = await loadClientModules(
    [
      {
        manifest: { id: "acme.probe", name: "Probe" },
        client: defineClientModule({
          activate(context) {
            ui = context.ui;
          },
        }),
      },
    ],
    async () => [
      {
        id: "acme.probe",
        name: "Probe",
        version: "1.0.0",
        licence: "MIT",
        author: "Acme",
        status: "loaded",
        error: null,
      },
    ],
  );
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  useUnits("mm");
  await act(async () => root.render(<Lengths />));
  expect(host.textContent).toBe(core("mm"));
  await act(async () => useUnits("in"));
  expect(host.textContent).toBe(core("in"));
  expect(core("in")).not.toBe(core("mm"));
  await act(async () => root.unmount());
  host.remove();
});
