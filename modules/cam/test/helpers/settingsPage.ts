import { act, createElement as h, Fragment } from "react";
import { afterEach, vi } from "vitest";
import { client, flush, host, root, runCommand } from "./camClient.js";

export type UserSettings = {
  values: Record<string, unknown>;
  patches: unknown[];
};

let store: any;

export async function mountSettings(user: UserSettings) {
  const [
    { Panels },
    { ConfirmPanel },
    { SettingsButton },
    { settingsApi },
    { useSession },
    settings,
  ] = await Promise.all([
    client("shell/panels.tsx"),
    client("components/ConfirmPanel.tsx"),
    client("components/SettingsPanel.tsx"),
    client("settingsApi.ts"),
    client("session.ts"),
    client("settings.ts"),
  ]);
  store = settings;
  useSession.setState({
    kind: "signed-in",
    user: { id: "u1", username: "mark", role: "admin", status: "active" },
  });
  vi.spyOn(settingsApi, "getAppSettings").mockResolvedValue({
    values: {},
    version: '"a"',
  });
  vi.spyOn(settingsApi, "getUserSettings").mockImplementation(async () => ({
    values: user.values,
    version: '"u"',
  }));
  vi.spyOn(settingsApi, "patchUserSettings").mockImplementation(
    async (patch: any) => {
      user.patches.push(patch);
      user.values = { ...user.values, ...patch.set };
      return { values: user.values, version: `"u${user.patches.length}"` };
    },
  );
  await settings.loadAppSettings();
  await settings.loadUserSettings();
  await act(async () =>
    root.render(
      h(Fragment, null, h(Panels), h(SettingsButton), h(ConfirmPanel)),
    ),
  );
}

afterEach(() => {
  store?.clearSettings();
  store = undefined;
  vi.restoreAllMocks();
});

export const settingsPanel = () => host.querySelector(".settings-panel")!;

export const button = (panel: Element, label: string) =>
  [...panel.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  ) as HTMLButtonElement;

export const field = (panel: Element, label: string) =>
  [...panel.querySelectorAll("label.field")].find(
    (l) => l.querySelector("span")?.textContent === label,
  )!;

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

export async function type(panel: Element, label: string, text: string) {
  const input = field(panel, label).querySelector("input")!;
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focus"));
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function choose(panel: Element, label: string, value: string) {
  const select = field(panel, label).querySelector("select")!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export async function click(panel: Element, label: string) {
  await act(async () => button(panel, label).click());
  await flush();
}

export async function openMachines() {
  await act(async () => void runCommand("rockett.cam.library"));
  await flush();
  return settingsPanel();
}
