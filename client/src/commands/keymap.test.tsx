import "./design";
import "../features/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DialogFooter } from "../components/form/DialogFooter";
import { ContextMenu } from "../components/ContextMenu";
import { installKeymap, registerHoldKey } from "./keymap";
import { useStore } from "../store";
import { ModelTree } from "../components/ModelTree";
import { api } from "../api";
import { registerGroupRecipient } from "../treeSelection";
import { runCommand } from "./registry";
import { createEmptyDocument, type MutationResponse } from "@rockett/shared";
import { sketchState } from "./sketch";

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

it("routes overlay Escape once without changing the underlying sketch", async () => {
  const state = sketchState("sk", "line");
  useStore.setState({ active: { id: "design.sketch", state }, busy: false });
  const close = vi.fn();
  const cancel = vi.fn();
  const downstream = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const dispose = installKeymap();
  try {
    await act(async () =>
      root.render(
        <div>
          <input onKeyDown={downstream} />
          <DialogFooter escapeAnywhere onCancel={cancel} />
          <ContextMenu x={0} y={0} items={[]} onClose={close} />
        </div>,
      ),
    );
    await act(async () =>
      host.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(downstream).not.toHaveBeenCalled();
    expect(useStore.getState().active).toEqual({ id: "design.sketch", state });
  } finally {
    await act(async () => root.unmount());
    dispose();
    host.remove();
  }
});

it("ignores composing dialog keys and consumes pending Escape before global cancellation", async () => {
  const onOk = vi.fn();
  const onCancel = vi.fn();
  const state = sketchState("sk", "line");
  useStore.setState({ active: { id: "design.sketch", state }, busy: false });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const dispose = installKeymap();
  try {
    await act(async () =>
      root.render(
        <div>
          <input />
          <DialogFooter escapeAnywhere onOk={onOk} onCancel={onCancel} />
        </div>,
      ),
    );
    await act(async () =>
      host.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
        }),
      ),
    );
    expect(onOk).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        <div>
          <input />
          <DialogFooter
            escapeAnywhere
            pending
            onOk={onOk}
            onCancel={onCancel}
          />
        </div>,
      ),
    );
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(useStore.getState().active).toEqual({ id: "design.sketch", state });
  } finally {
    await act(async () => root.unmount());
    dispose();
    host.remove();
  }
});

it("shares one listener across leases, releases held keys and tears down idempotently", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const down = vi.fn();
  const up = vi.fn();
  const unregister = registerHoldKey({
    id: "dom.hold",
    keys: ["Control"],
    press: down,
    release: up,
  });
  const first = installKeymap();
  const second = installKeymap();
  try {
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(
      1,
    );
    const input = document.body.appendChild(document.createElement("input"));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", bubbles: true }),
    );
    expect(down).toHaveBeenCalledOnce();
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Control", bubbles: true }),
    );
    expect(up).toHaveBeenCalledOnce();
    input.remove();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Control",
        repeat: true,
        bubbles: true,
      }),
    );
    expect(down).toHaveBeenCalledTimes(2);
    document.body.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Control", bubbles: true }),
    );
    expect(up).toHaveBeenCalledTimes(2);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", bubbles: true }),
    );
    window.dispatchEvent(new Event("blur"));
    expect(up).toHaveBeenCalledTimes(3);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", bubbles: true }),
    );
    first();
    first();
    expect(
      remove.mock.calls.filter(([type]) => type === "keydown"),
    ).toHaveLength(0);
    second();
    second();
    expect(up).toHaveBeenCalledTimes(4);
    expect(
      remove.mock.calls.filter(([type]) => type === "keydown"),
    ).toHaveLength(1);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", bubbles: true }),
    );
    expect(down).toHaveBeenCalledTimes(4);
  } finally {
    first();
    second();
    unregister();
    add.mockRestore();
    remove.mockRestore();
  }
});

it("leaves native input, textarea, select and editable typing untouched", async () => {
  useStore.setState({ active: null, busy: false });
  const dispose = installKeymap();
  const host = document.body.appendChild(document.createElement("div"));
  host.innerHTML =
    '<input/><textarea></textarea><select><option>one</option></select><div contenteditable="true">text</div>';
  try {
    for (const target of host.children) {
      const event = new KeyboardEvent("keydown", {
        key: "e",
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      expect(useStore.getState().active).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    }
  } finally {
    dispose();
    host.remove();
  }
});

const press = () =>
  act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "g",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );

it("shares grouping across mounted trees and keeps the remaining recipient alive", async () => {
  const doc = createEmptyDocument("group-keys", "Group keys");
  doc.features = ["s1", "s2"].map((id) => ({
    id,
    type: "sketch",
    name: id,
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [],
    constraints: [],
  }));
  doc.timelinePosition = doc.features.length;
  const evaluation = {
    bodies: [],
    planes: [],
    sketches: [],
    featureStatuses: [],
    kernelMs: 0,
  };
  const update = vi
    .spyOn(api, "updateGroups")
    .mockImplementation(async (_id, groups) => ({
      document: { ...doc, groups },
      evaluation,
    }));
  useStore.setState({
    document: doc,
    evaluation,
    projectId: doc.id,
    busy: false,
    active: null,
    selection: [
      { kind: "sketch", sketchId: "s1" },
      { kind: "sketch", sketchId: "s2" },
    ],
  });
  const firstHost = document.body.appendChild(document.createElement("div"));
  const secondHost = document.body.appendChild(document.createElement("div"));
  const first = createRoot(firstHost);
  const second = createRoot(secondHost);
  const uninstall = installKeymap();
  try {
    await act(async () => first.render(<ModelTree />));
    await act(async () => second.render(<ModelTree />));
    await press();
    expect(update).toHaveBeenCalledOnce();
    expect(firstHost.querySelector(".tree-rename")).toBeNull();
    expect(
      secondHost.querySelector<HTMLInputElement>(".tree-rename")?.value,
    ).toBe("Group 1");
    await act(async () => second.unmount());
    await press();
    expect(update).toHaveBeenCalledTimes(2);
    expect(
      firstHost.querySelector<HTMLInputElement>(".tree-rename")?.value,
    ).toBe("Group 2");
    await act(async () => first.unmount());
    await press();
    expect(update).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => first.unmount());
    await act(async () => second.unmount());
    uninstall();
    update.mockRestore();
    firstHost.remove();
    secondHost.remove();
  }
});

it("does not deliver an asynchronous group result to a disposed recipient", async () => {
  const doc = createEmptyDocument("group-pending", "Pending grouping");
  const evaluation = {
    bodies: [],
    planes: [],
    sketches: [],
    featureStatuses: [],
    kernelMs: 0,
  };
  let resolve: ((response: MutationResponse) => void) | undefined;
  const response = new Promise<MutationResponse>((done) => {
    resolve = done;
  });
  const update = vi.spyOn(api, "updateGroups").mockReturnValue(response);
  const stale = vi.fn();
  const remaining = vi.fn();
  const removeRemaining = registerGroupRecipient(remaining);
  const removeStale = registerGroupRecipient(stale);
  useStore.setState({
    document: doc,
    evaluation,
    projectId: doc.id,
    busy: false,
    active: null,
    selection: [{ kind: "sketch", sketchId: "s1" }],
  });
  try {
    const pending = runCommand("design.tree.group");
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    removeStale();
    removeStale();
    resolve!({
      document: { ...doc, groups: update.mock.calls[0]![1] },
      evaluation,
    });
    await pending;
    expect(stale).not.toHaveBeenCalled();
    expect(remaining).not.toHaveBeenCalled();
    update.mockResolvedValue({ document: { ...doc, groups: [] }, evaluation });
    await runCommand("design.tree.group");
    expect(update).toHaveBeenCalledTimes(2);
    expect(remaining).toHaveBeenCalledOnce();
  } finally {
    removeStale();
    removeRemaining();
    update.mockRestore();
  }
});
