import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { useStore, type Selection } from "../../src/store";

vi.mock("../../src/api", () => ({ api: {} }));

const profile: Selection = { kind: "profile", sketchId: "sk", profileId: "pr" };
const extrude = {
  id: "extrude1",
  type: "extrude",
  name: "Extrude1",
  suppressed: false,
  profiles: [{ sketchId: "sk", profileId: "pr" }],
  distance: 10,
  direction: "normal",
  operation: "join",
} as Feature;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

async function open(bodyIds: string[], editFeatureId?: string) {
  const document = createEmptyDocument("proj", "doc");
  if (editFeatureId) document.features = [extrude];
  useStore.setState({
    document,
    evaluation: {
      bodies: bodyIds.map((bodyId) => ({ bodyId })),
      planes: [],
      sketches: [],
      featureStatuses: [],
      kernelMs: 0,
    } as any,
    selection: [profile],
    dialogParams: editFeatureId
      ? { distance: 10, direction: "normal", operation: "join" }
      : {},
    mode: {
      name: "dialog",
      dialog: "extrude",
      ...(editFeatureId && { editFeatureId }),
    },
    previewNewFeature: vi.fn(async () => {}),
    updateFeaturePreview: vi.fn(async () => {}),
  });
  host = globalThis.document.body.appendChild(
    globalThis.document.createElement("div"),
  );
  root = createRoot(host);
  await act(async () => root!.render(<FeatureDialog />));
}

async function drag(params: Record<string, any>) {
  await act(async () => useStore.getState().setDialogParams(params));
}

const params = () => useStore.getState().dialogParams;

it("switches Join to Cut when the arrow drags below the surface, and back", async () => {
  await open(["b1"]);
  await drag({ distance: 5, direction: "reverse" });
  expect(params()).toMatchObject({ operation: "cut", autoCut: true });
  await drag({ distance: 4, direction: "normal" });
  expect(params()).toMatchObject({ operation: "join", autoCut: false });
});

it("keeps a Cut the user picked on either side", async () => {
  await open(["b1"]);
  await drag({ operation: "cut", autoCut: false });
  await drag({ distance: 5, direction: "reverse" });
  await drag({ distance: 5, direction: "normal" });
  expect(params()).toMatchObject({ operation: "cut", autoCut: false });
});

it("stays Join below the surface with no body to cut", async () => {
  await open([]);
  await drag({ distance: 5, direction: "reverse" });
  expect(params().operation ?? "join").toBe("join");
});

it("stays Join when the only body is the one the edited extrude made", async () => {
  await open(["b:extrude1"], "extrude1");
  await drag({ distance: 5, direction: "reverse" });
  expect(params().operation).toBe("join");
});
