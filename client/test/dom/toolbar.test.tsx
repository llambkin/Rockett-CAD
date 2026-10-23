import approved from "../fixtures/toolbarIcons.json";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Toolbar } from "../../src/components/Toolbar";
import { useStore } from "../../src/store";

it("opens the Extrude dialog when its toolbar button is clicked", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Toolbar />));

  const extrude = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Extrude",
  );
  await act(async () => extrude!.click());

  expect(useStore.getState().mode).toEqual({
    name: "dialog",
    dialog: "extrude",
  });
  await act(async () => root.unmount());
});

it.each([
  {
    format: "DXF",
    text: "0\nSECTION\n2\nENTITIES\n0\nPOINT\n10\n1\n20\n2\n0\nENDSEC\n",
    entity: { kind: "point", x: 1, y: 2 },
  },
  {
    format: "SVG",
    text: '<svg><circle cx="0" cy="0" r="96"/></svg>',
    entity: { kind: "circle" },
  },
])(
  "sends a chosen $format file from the sketch toolbar to placement",
  async ({ format, text, entity }) => {
    const original = useStore.getState().beginSketchImport;
    const insert = vi.fn();
    useStore.setState({
      mode: {
        name: "sketch",
        sketchId: "sk",
        tool: "select",
        constructionMode: false,
      },
      beginSketchImport: insert,
    });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(<Toolbar />));

    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === `Insert ${format}`,
    );
    const input = host.querySelector<HTMLInputElement>(
      `input[accept=".${format.toLowerCase()}"]`,
    )!;
    expect(button).toBeDefined();
    Object.defineProperty(input, "files", {
      value: [new File([text], `a.${format.toLowerCase()}`)],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );

    expect(insert).toHaveBeenCalledWith(
      format,
      {
        entities: expect.arrayContaining([expect.objectContaining(entity)]),
        skipped: 0,
      },
      false,
    );
    await act(async () => root.unmount());
    useStore.setState({ mode: { name: "idle" }, beginSketchImport: original });
  },
);

const UNDRAWN = ["Insert DXF", "Insert SVG"];

it("shows every approved icon on its toolbar button, named by its label", async () => {
  const shown = new Map<string, HTMLButtonElement>();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  for (const mode of [
    { name: "idle" as const },
    {
      name: "sketch" as const,
      sketchId: "sk",
      tool: "line" as const,
      constructionMode: false,
    },
  ]) {
    useStore.setState({ mode });
    await act(async () => root.render(<Toolbar />));
    for (const b of host.querySelectorAll<HTMLButtonElement>(".tb-btn"))
      if (!UNDRAWN.includes(b.textContent!))
        shown.set(b.getAttribute("aria-label") ?? b.textContent!, b);
  }
  await act(async () => root.unmount());
  useStore.setState({ mode: { name: "idle" } });

  expect([...shown.keys()].toSorted()).toEqual(
    approved.map((a) => a.label).toSorted(),
  );
  for (const { label, svg } of approved) {
    const button = shown.get(label)!;
    const icon = button.querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    icon.removeAttribute("aria-hidden");
    expect(icon.outerHTML, label).toBe(svg);
    expect(button.title.toLowerCase(), label).toContain(label.toLowerCase());
    expect(button.querySelector(".tb-label")?.textContent ?? label).toBe(label);
  }
});

it("offers no WebGL context", () => {
  const canvas = document.createElement("canvas");
  expect(canvas.getContext("webgl2")).toBeNull();
  expect(canvas.getContext("webgl")).toBeNull();
});
