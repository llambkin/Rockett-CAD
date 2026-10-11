import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClientUi } from "@rockett/plugin-api";
import {
  exportTools,
  importRockett,
  merge,
  TOOLS_FILE,
} from "../src/import/rockett.js";
import { importDialog } from "../src/client/toolPanel.js";
import type { Preset, Tool } from "../src/shared/tools.js";

const flat: Tool = {
  id: "t1",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const bull: Tool = {
  ...flat,
  id: "t2",
  name: "6 mm bull",
  kind: "bull",
  cornerRadius: 1,
};

const preset: Preset = {
  id: "p1",
  name: "MDF rough",
  rpm: 18000,
  cutFeed: 1800,
  plungeFeed: 600,
  rampFeed: 900,
  stepdown: 3,
  stepoverFraction: 0.4,
  coolant: "off",
};

const file = (body: object) => JSON.stringify(body);

const rockett = (tools: unknown[], presets: unknown[] = []) =>
  file({ format: "rockett-tools", version: 1, tools, presets });

describe("rockett-tools.json", () => {
  it("a file with the wrong format changes nothing", () => {
    const tools = [flat];
    const presets = [preset];
    const result = importRockett(
      file({
        format: "fusion-tools",
        version: 1,
        tools: [bull],
        presets: [{ ...preset, id: "p2" }],
      }),
    );
    expect(result).toEqual({
      tools: [],
      presets: [],
      rejects: [{ item: "File", reason: "is not a rockett-tools file" }],
    });
    expect(merge(tools, result.tools, false)).toBe(tools);
    expect(merge(tools, result.tools, true)).toBe(tools);
    expect(merge(presets, result.presets, true)).toBe(presets);
  });

  it("refuses a file that is not JSON or not version 1", () => {
    expect(importRockett("{tools").rejects).toEqual([
      { item: "File", reason: "is not JSON" },
    ]);
    expect(
      importRockett(file({ format: "rockett-tools", version: 2, tools: [] })),
    ).toEqual({
      tools: [],
      presets: [],
      rejects: [
        { item: "File", reason: "is version 2; this Rockett reads version 1" },
      ],
    });
    expect(
      importRockett(file({ format: "rockett-tools", version: 1 })).rejects,
    ).toEqual([{ item: "File", reason: "tools must be a list" }]);
  });

  it("round trips an export through import", () => {
    const text = exportTools([flat, bull], [preset]);
    expect(TOOLS_FILE).toBe("rockett-tools.json");
    expect(JSON.parse(text)).toEqual({
      format: "rockett-tools",
      version: 1,
      tools: [flat, bull],
      presets: [preset],
    });
    const result = importRockett(text);
    expect(result).toEqual({
      tools: [flat, bull],
      presets: [preset],
      rejects: [],
    });
    expect(merge([], result.tools, false)).toEqual([flat, bull]);
    expect(merge([], result.presets, false)).toEqual([preset]);
  });

  it("reads a file without presets as no presets", () => {
    expect(
      importRockett(
        file({ format: "rockett-tools", version: 1, tools: [flat] }),
      ),
    ).toEqual({ tools: [flat], presets: [], rejects: [] });
  });

  it("skips an existing id unless asked to replace it", () => {
    const mine = { ...flat, name: "My flat" };
    const tools = [mine];
    const { tools: incoming } = importRockett(rockett([flat, bull]));
    expect(merge(tools, incoming, false)).toEqual([mine, bull]);
    expect(merge(tools, incoming, true)).toEqual([flat, bull]);
    expect(merge(tools, [flat], false)).toBe(tools);
  });

  it("returns each rejected row with its reason", () => {
    const result = importRockett(
      rockett(
        [
          flat,
          { ...flat, id: "t3", name: "Saw", kind: "saw" },
          { ...flat, id: "t4", name: "Bad", diameter: "6" },
          { ...flat, id: "t5", name: "Zero", diameter: 0 },
          { ...bull, name: "No radius", cornerRadius: undefined },
          { ...flat, name: "Twin" },
          7,
        ],
        [
          preset,
          { ...preset, id: "p2", name: "Still", cutFeed: 0 },
          { ...preset, id: "p3", name: "Unlinked", toolId: "" },
        ],
      ),
    );
    expect(result.tools).toEqual([flat]);
    expect(result.presets).toEqual([preset]);
    expect(result.rejects).toEqual([
      { item: "Saw", reason: 'kind "saw" is not a tool kind' },
      { item: "Bad", reason: "diameter must be number" },
      { item: "Zero", reason: "diameter must be greater than 0" },
      {
        item: "No radius",
        reason: "must have required properties cornerRadius",
      },
      { item: "Twin", reason: "id t1 appears twice" },
      { item: "Tool 7", reason: "must be object" },
      { item: "Still", reason: "cutFeed must be greater than 0" },
      {
        item: "Unlinked",
        reason: "toolId must not have fewer than 1 characters",
      },
    ]);
  });
});

const ui = {
  DialogFooter: ({
    okLabel,
    okDisabled,
  }: {
    okLabel?: string;
    okDisabled?: boolean;
  }) => h("button", { disabled: okDisabled }, okLabel),
  CheckField: ({ label, value }: { label: string; value: boolean }) =>
    h("input", {
      type: "checkbox",
      "aria-label": label,
      checked: value,
      readOnly: true,
    }),
} as unknown as ClientUi;

const dialog = (replace: boolean, text: string) =>
  renderToStaticMarkup(
    importDialog(ui, {
      name: "tools.json",
      result: importRockett(text),
      tools: [flat],
      presets: [],
      replace,
      error: null,
      pending: false,
      setReplace: () => {},
      onOk: () => {},
      onCancel: () => {},
    }),
  );

describe("import dialog", () => {
  it("lists tools, presets and rejects with their reasons", () => {
    const html = dialog(
      false,
      rockett(
        [flat, bull, { ...flat, id: "t9", name: "Zero", diameter: 0 }],
        [preset],
      ),
    );
    expect(html).toContain('<span class="field-hint">Import tools.json</span>');
    expect(html).toContain(
      "<span>6 mm flat</span><span>Skipped, already in your library</span>",
    );
    expect(html).toContain("<span>6 mm bull</span><span>New</span>");
    expect(html).toContain("<span>MDF rough</span><span>New</span>");
    expect(html).toContain(
      "<span>Zero</span><span>diameter must be greater than 0</span>",
    );
    expect(html).toContain("<button>Import</button>");
  });

  it("marks a replace and disables Import when nothing changes", () => {
    const text = rockett([flat]);
    expect(dialog(true, text)).toContain(
      "<span>6 mm flat</span><span>Replaces yours</span>",
    );
    expect(dialog(false, text)).toContain(
      '<button disabled="">Import</button>',
    );
    expect(dialog(false, file({ format: "other" }))).toContain(
      "<span>File</span><span>is not a rockett-tools file</span>",
    );
  });
});
