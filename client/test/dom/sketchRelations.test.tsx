import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Toolbar } from "../../src/components/Toolbar";
import { ViewportContextMenu } from "../../src/components/ViewportContextMenu";
import { useStore, type Selection } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";
import { entities, TYPES, toolbarCases } from "../helpers/sketchRelationCases";

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  viewportHandle.current = null;
});

function sketchState(ids: string[]) {
  useStore.setState({
    document: null,
    mode: {
      name: "sketch",
      sketchId: "s1",
      tool: "select",
      constructionMode: false,
    },
    draftSketch: {
      id: "s1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: structuredClone(entities),
      constraints: [],
    },
    error: null,
    selection: ids.map((entityId) => ({
      kind:
        entities.find((e) => e.id === entityId)?.kind === "point"
          ? "sketchPoint"
          : "sketchEntity",
      sketchId: "s1",
      entityId,
    })) as Selection[],
  });
}

async function mount(ui: ReactElement) {
  const host = document.body.appendChild(document.createElement("div"));
  hosts.push(host);
  const root = createRoot(host);
  await act(async () => root.render(ui));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const label = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

it("builds the same constraints from the toolbar for each selection", async () => {
  for (const { ids, made } of toolbarCases) {
    for (const type of TYPES) {
      sketchState(ids);
      const { host, unmount } = await mount(<Toolbar />);
      const button = host.querySelector<HTMLButtonElement>(
        `button[aria-label="${label(type)}"]`,
      )!;
      await act(async () => button.click());
      await unmount();
      const added = useStore.getState().draftSketch!.constraints;
      const expected = made[type];
      if (expected) expect(added, `${ids} ${type}`).toMatchObject([expected]);
      else expect(added, `${ids} ${type}`).toEqual([]);
    }
  }
});

it("offers Coincident for a point and a circle on right-click and applies it", async () => {
  sketchState(["q", "o1"]);
  viewportHandle.current = { projection: "perspective" } as any;
  const { host } = await mount(
    <ViewportContextMenu
      menu={{ x: 20, y: 30, sel: null }}
      onClose={() => {}}
      isPlanarFace={() => false}
      alignToSketch={() => {}}
      onDimension={() => {}}
    />,
  );
  const items = [...host.querySelectorAll(".context-menu button")];
  expect(items.map((b) => b.textContent).slice(0, 2)).toEqual([
    "Coincident",
    "Fit",
  ]);
  await act(async () => (items[0] as HTMLButtonElement).click());
  expect(useStore.getState().draftSketch!.constraints).toMatchObject([
    { type: "pointOnCircle", point: "q", circle: "o1" },
  ]);
  expect(useStore.getState().selection).toEqual([]);
});

it("lists relations before the entity items when the click lands on the selection", async () => {
  sketchState(["q", "l1"]);
  const { host } = await mount(
    <ViewportContextMenu
      menu={{
        x: 20,
        y: 30,
        sel: { kind: "sketchEntity", sketchId: "s1", entityId: "l1" },
      }}
      onClose={() => {}}
      isPlanarFace={() => false}
      alignToSketch={() => {}}
      onDimension={() => {}}
    />,
  );
  expect(
    [...host.querySelectorAll(".context-menu button")].map(
      (b) => b.textContent,
    ),
  ).toEqual([
    "Coincident",
    "Midpoint",
    "Delete (2)",
    "Toggle construction (selection)",
    "Length and angle…",
  ]);
});

it("offers no relations outside sketch mode", async () => {
  sketchState(["q", "o1"]);
  useStore.setState({ mode: { name: "idle" } });
  viewportHandle.current = { projection: "perspective" } as any;
  const { host } = await mount(
    <ViewportContextMenu
      menu={{ x: 20, y: 30, sel: null }}
      onClose={() => {}}
      isPlanarFace={() => false}
      alignToSketch={() => {}}
      onDimension={() => {}}
    />,
  );
  expect(host.querySelector(".context-menu button")!.textContent).toBe("Fit");
});
