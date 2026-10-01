import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, emptyView } from "@rockett/shared";
import { App } from "./App";
import { useStore } from "./store";
import { ViewportContext } from "./viewportRef";
import type { CadViewport } from "./three/CadViewport";

const controls = vi.hoisted(() => ({
  fit: vi.fn(),
  view: vi.fn(),
  projection: vi.fn(),
}));

const viewport = {
  current: {
    zoomToFit: controls.fit,
    setView: controls.view,
    setProjection: controls.projection,
    projection: "perspective",
  } as unknown as CadViewport,
};

vi.mock("./components/ViewportView", () => ({
  ViewportView: ({
    children,
  }: {
    children?: (viewport: ReactNode) => ReactNode;
  }) => (
    <ViewportContext value={viewport}>
      {children ? (
        children(<div className="viewport-container" />)
      ) : (
        <div className="viewport-container" />
      )}
    </ViewportContext>
  ),
}));
vi.mock("./session", () => ({
  useSession: () => ({
    kind: "signed-in",
    user: { id: "test", role: "admin" },
  }),
  bootSession: vi.fn(async () => {}),
}));
vi.mock("./components/UserMenu", () => ({ UserMenu: () => null }));
vi.mock("./browserSession", () => ({
  dropBrowserCopy: vi.fn(),
  followPath: vi.fn(),
}));
vi.mock("./settings", async (original) => ({
  ...(await original<typeof import("./settings")>()),
  loadAppSettings: vi.fn(async () => {}),
  loadUserSettings: vi.fn(async () => {}),
  openProjectSettings: vi.fn(async () => {}),
  closeProjectSettings: vi.fn(),
}));
vi.mock("./api", () => ({
  watchUnauthorized: vi.fn(),
  api: {
    health: vi.fn(() => new Promise(() => {})),
    formats: vi.fn(async () => ({ exporters: [], importers: [] })),
  },
}));

const initial = useStore.getState();
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  useStore.setState(initial, true);
  vi.clearAllMocks();
});

it("routes workspace toolbar, named view and keyboard actions through its viewport scope", async () => {
  const document = createEmptyDocument("workspace", "Workspace");
  useStore.setState({
    projectId: document.id,
    document,
    view: emptyView(),
    mode: { name: "idle" },
    active: null,
    busy: false,
  });
  host = globalThis.document.body.appendChild(
    globalThis.document.createElement("div"),
  );
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  await act(async () =>
    host!.querySelector<HTMLButtonElement>('button[aria-label="Fit"]')!.click(),
  );
  expect(controls.fit).toHaveBeenCalledOnce();
  await act(async () =>
    globalThis.document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", shiftKey: true, bubbles: true }),
    ),
  );
  expect(controls.fit).toHaveBeenCalledTimes(2);
  const views = host.querySelector<HTMLSelectElement>(
    'select[title="Named views"]',
  )!;
  await act(async () => {
    views.value = "Front";
    views.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(controls.view).toHaveBeenCalledOnce();
  await act(async () => root!.unmount());
  globalThis.document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "f", shiftKey: true, bubbles: true }),
  );
  expect(controls.fit).toHaveBeenCalledTimes(2);
});
