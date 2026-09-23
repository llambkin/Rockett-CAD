import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  AngleField,
  AxisField,
  LengthField,
  NumField,
} from "../../src/components/form/fields";
import { Toolbar } from "../../src/components/Toolbar";
import { useStore } from "../../src/store";

async function mount(element: ReactElement) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    unmount: () => act(async () => root.unmount()),
  };
}

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focus"));
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("reports only the finished number from partial input", async () => {
  const onChange = vi.fn();
  const { host, unmount } = await mount(
    <NumField label="Offset" value={5} onChange={onChange} />,
  );
  const input = host.querySelector("input")!;
  await type(input, "-");
  await type(input, "-2");
  expect(onChange.mock.calls).toEqual([[-2]]);
  await unmount();
});

it("reports nothing when the box is cleared", async () => {
  const onChange = vi.fn();
  const { host, unmount } = await mount(
    <NumField label="Offset" value={5} onChange={onChange} />,
  );
  await type(host.querySelector("input")!, "");
  expect(onChange).not.toHaveBeenCalled();
  await unmount();
});

it("does not report a value outside min and max", async () => {
  const onChange = vi.fn();
  const { host, unmount } = await mount(
    <NumField
      label="Sides"
      ariaLabel="Polygon sides"
      value={6}
      onChange={onChange}
      int
      min={3}
      max={24}
    />,
  );
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Polygon sides"]',
  )!;
  expect([input.min, input.max, input.step]).toEqual(["3", "24", "1"]);
  await type(input, "25");
  await type(input, "2");
  await type(input, "12");
  expect(onChange.mock.calls).toEqual([[12]]);
  await unmount();
});

it("switches AxisField to the selected edge", async () => {
  const onChange = vi.fn();
  const { host, unmount } = await mount(
    <AxisField axisSource={undefined} axis={undefined} onChange={onChange} />,
  );
  const select = host.querySelector("select")!;
  expect(select.value).toBe("Z");
  await act(async () => {
    select.value = "edge";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({ axisSource: "edge" });
  await unmount();
});

it("shows LengthField in its units and reports millimetres", async () => {
  const onChange = vi.fn();
  const { host, unmount } = await mount(
    <LengthField
      label="Distance"
      value={25.4}
      units="in"
      onChange={onChange}
    />,
  );
  const input = host.querySelector("input")!;
  expect(host.querySelector("span")!.textContent).toBe("Distance (in)");
  expect(input.value).toBe("1");
  await type(input, "2");
  expect(onChange.mock.calls).toEqual([[50.8]]);
  await unmount();
});

it("shows AngleField in degrees", async () => {
  const onChange = vi.fn();
  const { host, unmount } = await mount(
    <AngleField label="Angle" value={90} onChange={onChange} />,
  );
  const input = host.querySelector("input")!;
  expect(host.querySelector("span")!.textContent).toBe("Angle (°)");
  expect(input.value).toBe("90");
  await type(input, "45");
  expect(onChange.mock.calls).toEqual([[45]]);
  await unmount();
});

describe("raw number inputs", () => {
  it("exist only in the form kit", () => {
    const dir = join(import.meta.dirname, "../../src/components");
    const hits = (readdirSync(dir, { recursive: true }) as string[]).filter(
      (f) =>
        f.endsWith(".tsx") &&
        readFileSync(join(dir, f), "utf8").includes('type="number"'),
    );
    expect(hits).toEqual([join("form", "fields.tsx")]);
  });

  it("leave polygon sides alone when the box is cleared", async () => {
    useStore.setState({
      mode: {
        name: "sketch",
        sketchId: "sk",
        tool: "polygon",
        constructionMode: false,
      },
      dialogParams: { polygonSides: 8 },
    });
    const { host, unmount } = await mount(<Toolbar />);
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Polygon sides"]',
    )!;
    expect([input.className, input.title, input.value]).toEqual([
      "tb-input",
      "Polygon sides",
      "8",
    ]);
    await type(input, "");
    await type(input, "30");
    expect(useStore.getState().dialogParams.polygonSides).toBe(8);
    await type(input, "5");
    expect(useStore.getState().dialogParams.polygonSides).toBe(5);
    await unmount();
  });
});
