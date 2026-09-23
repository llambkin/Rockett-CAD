import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AxisField, NumField } from "../../src/components/form/fields";

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
