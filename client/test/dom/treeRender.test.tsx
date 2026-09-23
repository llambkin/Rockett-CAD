import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { ModelTree } from "../../src/components/ModelTree";
import { useStore } from "../../src/store";

const COUNT = 1000;

const bodies = () =>
  Array.from({ length: COUNT }, (_, n) => ({
    bodyId: `b${n}`,
    name: `Body${n}`,
    visible: true,
  }));

const evaluation = () =>
  ({
    bodies: bodies(),
    planes: [],
    kernelMs: 0,
    featureStatuses: [],
    sketches: [],
  }) as any;

function Workspace() {
  useStore((s) => s.busy);
  return <ModelTree />;
}

let host: HTMLElement;
let root: Root;

const bodyRowProps = () =>
  [
    ...host.querySelectorAll(
      '.tree-item[title="Click to select · right-click for actions"]',
    ),
  ].map((el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return (el as any)[key!] as object;
  });

const replaced = (before: object[]) =>
  bodyRowProps().filter((props, i) => props !== before[i]).length;

beforeEach(() => {
  useStore.setState({
    projectId: "p1",
    document: createEmptyDocument("p1", "Part"),
    evaluation: evaluation(),
    mode: { name: "idle" },
    selection: [],
    busy: false,
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root.render(<Workspace />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("keeps every body row when a new evaluation holds the same bodies", () => {
  const before = bodyRowProps();
  expect(before).toHaveLength(COUNT);
  act(() => useStore.setState({ evaluation: evaluation() }));
  expect(replaced(before)).toBe(0);
});

it("re-renders only the body row whose selection changed", () => {
  const before = bodyRowProps();
  act(() => useStore.setState({ selection: [{ kind: "body", bodyId: "b7" }] }));
  expect(replaced(before)).toBe(1);
  expect(host.querySelectorAll(".tree-item.selected")).toHaveLength(1);
});

it("skips the tree when a busy flip renders its parent", () => {
  const before = bodyRowProps();
  act(() => useStore.setState({ busy: true }));
  expect(replaced(before)).toBe(0);
});

it("re-renders only the body row whose visibility changed", () => {
  const before = bodyRowProps();
  const next = evaluation();
  next.bodies[3].visible = false;
  act(() => useStore.setState({ evaluation: next }));
  expect(replaced(before)).toBe(1);
  expect(host.querySelectorAll(".dimmed")).toHaveLength(1);
});
