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
  "sends a chosen $format file from the sketch toolbar to the draft insert",
  async ({ format, text, entity }) => {
    const original = useStore.getState().insertSketchImport;
    const insert = vi.fn(async () => {});
    useStore.setState({
      mode: {
        name: "sketch",
        sketchId: "sk",
        tool: "select",
        constructionMode: false,
      },
      insertSketchImport: insert,
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

    expect(insert).toHaveBeenCalledWith(format, {
      entities: expect.arrayContaining([expect.objectContaining(entity)]),
      skipped: 0,
    });
    await act(async () => root.unmount());
    useStore.setState({ mode: { name: "idle" }, insertSketchImport: original });
  },
);

it("offers no WebGL context", () => {
  const canvas = document.createElement("canvas");
  expect(canvas.getContext("webgl2")).toBeNull();
  expect(canvas.getContext("webgl")).toBeNull();
});
