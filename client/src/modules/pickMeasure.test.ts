import "../commands/design";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defineClientModule,
  type ClientContext,
  type Dispose,
  type PickRef,
} from "@rockett/plugin-api";
import { createEmptyDocument, type EvaluateResult } from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture";
import { activeCommand } from "../commands/active";
import { handleKey } from "../commands/keymap";
import { commandById } from "../commands/registry";
import { useStore, type Selection } from "../store";
import { loadClientModules } from "./host";

const MODULE = "acme.probe";
const COMMAND = `${MODULE}.run`;

const yielded: (PickRef | null)[] = [];
let context: ClientContext;
let end: Dispose | null = null;
let ended = 0;
let unload: Dispose = () => {};

const probe = defineClientModule({
  activate(ctx) {
    context = ctx;
    ctx.register.command({
      id: COMMAND,
      label: "Probe",
      keys: ["Q"],
      keyContext: "design",
      run() {
        if (end) return end();
        end = ctx.project.pick({
          command: COMMAND,
          kinds: ["face", "edge", "vertex", "body"],
          hint: "Pick two",
          onPick(ref) {
            yielded.push(ref);
            ctx.project.select(ref ? [...ctx.project.picks(), ref] : []);
          },
          onEnd() {
            end = null;
            ended++;
          },
        });
      },
    });
  },
});

const initial = useStore.getState();
const direct = globalThis.fetch;
const press = (key: string) =>
  handleKey({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    preventDefault() {},
  });
const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
const click = (selection: Selection | null) =>
  activeCommand()!.onClick(selection, plain);

beforeEach(async () => {
  useStore.setState(
    {
      ...initial,
      projectId: "part",
      document: createEmptyDocument("part", "Part"),
    },
    true,
  );
  yielded.length = 0;
  ended = 0;
  unload = await loadClientModules(
    [{ manifest: { id: MODULE, name: "Probe" }, client: probe }],
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
  useStore.setState(initial, true);
  vi.unstubAllGlobals();
});

const face: Selection = { kind: "face", bodyId: "b", faceName: "top" };
const edge: Selection = { kind: "edge", bodyId: "b", edgeName: "e1" };
const sketch: Selection = { kind: "sketch", sketchId: "s" };

it("yields each picked entity and ends on Escape", async () => {
  press("q");
  expect(useStore.getState().active?.id).toBe("module.pick");
  const mode = activeCommand()!;
  expect(mode.hint).toBe("Pick two");
  expect(mode.pickFilter()).toEqual([
    "design.face",
    "design.edge",
    "design.vertex",
    "design.body",
  ]);
  expect(mode.onHover(sketch, plain)).toBeNull();
  expect(mode.onHover(edge, plain)).toBe(edge);
  const toolbar = commandById(COMMAND)!;
  expect(toolbar.active?.(useStore.getState())).toBe(true);

  await click(face);
  await click(sketch);
  await click(edge);
  expect(yielded).toEqual([
    { kind: "face", bodyId: "b", faceName: "top" },
    { kind: "edge", bodyId: "b", edgeName: "e1" },
  ]);
  expect(context.project.picks()).toEqual(yielded);
  expect(useStore.getState().selection).toEqual(yielded);
  await click(null);
  expect(yielded.at(-1)).toBeNull();
  expect(context.project.picks()).toEqual([]);

  press("Escape");
  expect(useStore.getState().active).toBeNull();
  expect(toolbar.active?.(useStore.getState())).toBe(false);
  expect(ended).toBe(1);
  expect(end).toBeNull();
});

it("ends on its own key, a project change, a document change and unload", () => {
  press("q");
  press("q");
  expect(useStore.getState().active).toBeNull();
  expect(ended).toBe(1);

  press("q");
  useStore.setState({ projectId: "other" });
  expect(useStore.getState().active).toBeNull();
  expect(ended).toBe(2);

  press("q");
  useStore.setState({ document: createEmptyDocument("other", "Edited") });
  expect(useStore.getState().active).toBeNull();
  expect(ended).toBe(3);

  press("q");
  const retained = end!;
  unload();
  unload = () => {};
  expect(useStore.getState().active).toBeNull();
  expect(ended).toBe(4);
  retained();
  expect(ended).toBe(4);
});

it("refuses a pick mode for another module's command", () => {
  expect(() =>
    context.project.pick({
      command: "other.mod.run",
      kinds: ["face"],
      hint: "Steal",
      onPick() {},
    }),
  ).toThrow("other.mod.run is not a command of acme.probe");
  expect(useStore.getState().active).toBeNull();
});

it("measures two picks through the core route and refuses an outsider", async () => {
  const fixture = await moduleProjectFixture({ id: "acme.none", mount() {} });
  try {
    let who = fixture.editor;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      typeof input === "string" && input.startsWith("/api/")
        ? fixture.request(input.slice(4), init, who)
        : direct(input, init),
    );
    const id = fixture.doc.id;
    for (const name of ["fixture-wedge-a.step", "fixture-wedge-b.step"]) {
      const { revision } = await fixture.store.load(id);
      const form = new FormData();
      form.append(
        "file",
        new Blob([
          await readFile(
            new URL(
              `../../../modules/kicad/test/fixtures/reference/source/models/${name}`,
              import.meta.url,
            ),
          ),
        ]),
        name,
      );
      const imported = await fixture.request(`/projects/${id}/import`, {
        method: "POST",
        headers: { "If-Match": `"${revision}"` },
        body: form,
      });
      expect(imported.status).toBe(200);
    }
    const evaluated = await fixture.request(`/projects/${id}/evaluate`, {
      method: "POST",
    });
    const { bodies } = (await evaluated.json()) as EvaluateResult;
    expect(bodies).toHaveLength(2);
    useStore.setState({
      projectId: id,
      document: await fixture.store.load(id),
      selection: [],
    });

    press("q");
    for (const { bodyId } of bodies) await click({ kind: "body", bodyId });
    const refs = context.project.picks();
    expect(refs).toEqual(
      bodies.map(({ bodyId }) => ({ kind: "body", bodyId })),
    );

    const core = await fixture.request(`/projects/${id}/measure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    });
    expect(core.status).toBe(200);
    const expected = await core.json();
    expect(expected).toMatchObject({
      distance: expect.any(Number),
      items: [
        { kind: "body", volume: expect.any(Number) },
        { kind: "body", volume: expect.any(Number) },
      ],
    });
    await expect(context.project.measure(refs)).resolves.toEqual(expected);

    who = fixture.outsider;
    await expect(context.project.measure(refs)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    await fixture.close();
  }
}, 120_000);
