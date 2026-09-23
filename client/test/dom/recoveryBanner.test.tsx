import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryBanner } from "../../src/App";
import { useStore } from "../../src/store";

let host: HTMLElement;
let root: Root;
const recover = vi.fn(async () => {});

beforeEach(async () => {
  useStore.setState({ recover, recovery: null });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<RecoveryBanner />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  recover.mockClear();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

it("shows nothing until a change is not saved", () => {
  expect(host.textContent).toBe("");
});

it("offers reapply and a confirmed discard for a conflict", async () => {
  await act(async () =>
    useStore.setState({
      recovery: { kind: "conflict", message: "Changed elsewhere." },
    }),
  );
  expect(host.querySelector(".error-banner")?.textContent).toContain(
    "Changed elsewhere.",
  );
  await act(async () => button("Reload and reapply my change").click());
  expect(recover).toHaveBeenLastCalledWith("reapply");
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  await act(async () => button("Discard my change").click());
  expect(recover).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  await act(async () => button("Discard my change").click());
  expect(recover).toHaveBeenLastCalledWith("discard");
});

it("offers Retry when the server could not be reached", async () => {
  await act(async () =>
    useStore.setState({
      recovery: { kind: "offline", message: "Offline." },
    }),
  );
  await act(async () => button("Retry").click());
  expect(recover).toHaveBeenLastCalledWith("reapply");
});
