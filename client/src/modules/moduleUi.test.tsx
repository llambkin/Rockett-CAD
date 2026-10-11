import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineClientModule, type ClientUi } from "@rockett/plugin-api";
import { formatAngle } from "@rockett/shared";
import { useSettings } from "../settings";
import { useStore } from "../store";
import { loadClientModules } from "./host";

const MODULE = "acme.probe";
const PANEL = `${MODULE}.panel`;
const saved = { kind: "floating", x: 300, y: 200, width: 200, height: 100 };

let ui: ClientUi;
let unload = () => {};

beforeEach(async () => {
  Object.defineProperty(window, "innerWidth", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 700, y: 60, width: 200, height: 100 }),
  );
  unload = await loadClientModules(
    [
      {
        manifest: { id: MODULE, name: "Probe" },
        client: defineClientModule({
          activate(context) {
            ui = context.ui;
          },
        }),
      },
    ],
    async () => [
      {
        id: MODULE,
        name: "Probe",
        version: "1.0.0",
        licence: "MIT",
        author: "Acme",
        status: "loaded",
        error: null,
      },
    ],
  );
});

afterEach(() => {
  unload();
  document.body.replaceChildren();
  useStore.getState().setError(null);
  vi.restoreAllMocks();
});

async function render(id: string) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ui.DraggablePanel id={id} title="Probe" className="measure">
        <div className="dialog-body" />
      </ui.DraggablePanel>,
    ),
  );
  const panel = host.querySelector<HTMLElement>(".dialog-panel")!;
  await act(async () => root.unmount());
  host.remove();
  return panel;
}

it("restores a module panel's saved position and carries its class", async () => {
  useSettings.setState((s) => ({
    resolved: {
      ...s.resolved,
      "layout.panels": {
        value: { design: { [PANEL]: saved } },
        source: "user",
      },
    },
  }));
  const panel = await render(PANEL);
  expect(panel.classList).toContain("measure");
  expect(panel.style.left).toBe("300px");
  expect(panel.style.top).toBe("200px");
});

it("refuses a panel id outside the module's namespace", async () => {
  await expect(render("inspect.measure")).rejects.toThrow(
    `panel inspect.measure must start with ${MODULE}.`,
  );
});

it("formats angles as core formats them", () => {
  for (const [deg, digits] of [
    [45, 3],
    [12.34567, 4],
    [-179.99999, 4],
  ] as const)
    expect(ui.formatAngle(deg, digits)).toBe(formatAngle(deg, digits));
});

it("shows a module error on the core error line", () => {
  ui.showError("Pick two faces.");
  expect(useStore.getState().error).toBe("Pick two faces.");
});
