import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type EvaluateResult,
  type Feature,
} from "@rockett/shared";
import { Timeline } from "../../src/components/Timeline";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore } from "../../src/store";
import { api } from "../../src/api";

vi.mock("../../src/api", () => ({
  api: { evaluate: vi.fn() },
}));

const feature = (id: string, name: string) =>
  ({
    id,
    type: "shell",
    name,
    suppressed: false,
    openFaces: [],
    thickness: 1,
  }) as unknown as Feature;

const current = {
  bodies: [{ bodyId: "now" }],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
} as unknown as EvaluateResult;
const past = { ...current, bodies: [] } as EvaluateResult;

let doc: CadDocument;
let undoStack: CadDocument[];
let answer: (value: EvaluateResult) => void;
let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(api.evaluate).mockImplementation(
    () => new Promise((resolve) => (answer = resolve)),
  );
  doc = createEmptyDocument("proj", "doc");
  doc.features = [feature("a", "A1"), feature("b", "B1"), feature("c", "C1")];
  doc.timelinePosition = 3;
  undoStack = [createEmptyDocument("proj", "doc")];
  useStore.setState({
    projectId: doc.id,
    document: doc,
    evaluation: current,
    busy: false,
    error: null,
    undoStack,
    redoStack: [],
    previewBaseline: null,
    selection: [],
    dialogParams: {},
    mode: { name: "idle" },
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<Timeline />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const chip = (name: string) =>
  [...host.querySelectorAll(".tl-chip")].find((c) =>
    c.textContent?.includes(name),
  )!;

async function over(el: Element, from: Element | null = null) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }),
    );
  });
}

async function out(el: Element, to: Element = document.body) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }),
    );
  });
}

async function reply(value: EvaluateResult) {
  await act(async () => answer(value));
}

it("sends nothing for a hover shorter than the dwell", async () => {
  await over(chip("B1"));
  await wait(PREVIEW_DWELL_MS - 1);
  await out(chip("B1"));
  await wait(PREVIEW_DWELL_MS * 3);
  expect(api.evaluate).not.toHaveBeenCalled();
});

it("shows the model after the hovered feature once the dwell passes, and leaving restores it", async () => {
  await over(chip("B1"));
  await wait(PREVIEW_DWELL_MS);
  expect(vi.mocked(api.evaluate).mock.calls).toEqual([["proj", 2]]);
  await reply(past);
  expect(useStore.getState().evaluation).toBe(past);
  await wait(PREVIEW_DWELL_MS * 3);
  expect(api.evaluate).toHaveBeenCalledOnce();
  await out(chip("B1"));
  const s = useStore.getState();
  expect(s.evaluation).toBe(current);
  expect(s.document).toBe(doc);
  expect(s.document!.timelinePosition).toBe(3);
  expect(s.undoStack).toBe(undoStack);
  expect(s.undoStack).toHaveLength(1);
  expect(s.redoStack).toEqual([]);
});

it("sends nothing while crossing chips inside the dwell, then previews only the chip it rests on", async () => {
  await over(chip("A1"));
  await wait(PREVIEW_DWELL_MS / 2);
  await out(chip("A1"), chip("B1"));
  await over(chip("B1"), chip("A1"));
  await wait(PREVIEW_DWELL_MS / 2);
  await out(chip("B1"), chip("C1"));
  await over(chip("C1"), chip("B1"));
  expect(api.evaluate).not.toHaveBeenCalled();
  await wait(PREVIEW_DWELL_MS);
  expect(vi.mocked(api.evaluate).mock.calls).toEqual([["proj", 3]]);
});

it("drops an answer that arrives after the chip is left", async () => {
  await over(chip("A1"));
  await wait(PREVIEW_DWELL_MS);
  await out(chip("A1"));
  await reply(past);
  expect(useStore.getState().evaluation).toBe(current);
});

it("restores the current model when an edit starts", async () => {
  await over(chip("A1"));
  await wait(PREVIEW_DWELL_MS);
  await reply(past);
  expect(useStore.getState().evaluation).toBe(past);
  await act(async () => {
    useStore.setState({ busy: true });
  });
  expect(useStore.getState().evaluation).toBe(current);
});

it("does not preview while a dialog or a quick edit is open", async () => {
  await act(async () => {
    useStore.setState({ mode: { name: "dialog", dialog: "shell" } });
  });
  await over(chip("A1"));
  await wait(PREVIEW_DWELL_MS * 2);
  await out(chip("A1"));
  await act(async () => {
    useStore.setState({ mode: { name: "idle" } });
  });
  await act(async () => {
    chip("A1").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const item = [...document.querySelectorAll(".context-menu button")].find(
    (b) => b.textContent === "Quick edit",
  ) as HTMLButtonElement;
  await act(async () => item.click());
  await over(chip("B1"));
  await wait(PREVIEW_DWELL_MS * 2);
  expect(api.evaluate).not.toHaveBeenCalled();
});
