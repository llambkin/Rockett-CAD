import { readFileSync } from "node:fs";
import type { Vec3 } from "@rockett/shared";

declare const BLEND_WASM_URL: string;

type Exports = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  buffer(): number;
  fillet_planes(): number;
  fillet_section(): number;
  chamfer_section(): number;
};

export type PlaneSide = { normal: Vec3; into: Vec3 };
export type ChamferSide = PlaneSide & { radius: number };
export type FilletSection = { centre: Vec3; contacts: [Vec3, Vec3] };

let compiled: WebAssembly.Module | undefined;

export function blendModule(): WebAssembly.Module {
  compiled ??= new WebAssembly.Module(
    readFileSync(
      new URL(
        typeof BLEND_WASM_URL === "string"
          ? BLEND_WASM_URL
          : "../../../modules/kernel/blend/blend.wasm",
        import.meta.url,
      ),
    ),
  );
  return compiled;
}

function call(
  module: WebAssembly.Module,
  name: "fillet_planes" | "fillet_section" | "chamfer_section",
  input: number[],
  outputs: number,
) {
  const wasm = new WebAssembly.Instance(module, {}).exports as Exports;
  try {
    wasm["_initialize"]();
    const io = new Float64Array(wasm.memory.buffer, wasm.buffer(), 39);
    io.set(input);
    const status = wasm[name]();
    return status === 0
      ? Array.from(io.subarray(input.length, input.length + outputs))
      : null;
  } catch (error) {
    if (!(error instanceof WebAssembly.RuntimeError)) throw error;
    throw new Error(`the blend module stopped (${error.message})`, {
      cause: error,
    });
  }
}

function filletSections(out: number[]): [FilletSection, FilletSection] {
  const at = (i: number): Vec3 => [out[i]!, out[i + 1]!, out[i + 2]!];
  const section = (i: number): FilletSection => ({
    centre: at(i),
    contacts: [at(i + 3), at(i + 6)],
  });
  return [section(0), section(9)];
}

export function filletBetweenPlanes(
  edge: [Vec3, Vec3],
  sides: [PlaneSide, PlaneSide],
  radius: number,
): [FilletSection, FilletSection] | null {
  const [a, b] = sides;
  const out = call(
    blendModule(),
    "fillet_planes",
    [
      ...edge[0],
      ...edge[1],
      ...a.normal,
      ...a.into,
      ...b.normal,
      ...b.into,
      radius,
    ],
    18,
  );
  return out && filletSections(out);
}

function sectionInputs(
  edge: [Vec3, Vec3],
  [a, b]: [ChamferSide, ChamferSide],
  size: number,
) {
  return [
    ...edge[0],
    ...edge[1],
    ...a.normal,
    ...a.into,
    a.radius,
    ...b.normal,
    ...b.into,
    b.radius,
    size,
  ];
}

export function filletSection(
  edge: [Vec3, Vec3],
  sides: [ChamferSide, ChamferSide],
  radius: number,
): [FilletSection, FilletSection] | null {
  const out = call(
    blendModule(),
    "fillet_section",
    sectionInputs(edge, sides, radius),
    18,
  );
  return out && filletSections(out);
}

export function chamferSection(
  edge: [Vec3, Vec3],
  sides: [ChamferSide, ChamferSide],
  distance: number,
): [[Vec3, Vec3], [Vec3, Vec3]] | null {
  const out = call(
    blendModule(),
    "chamfer_section",
    sectionInputs(edge, sides, distance),
    12,
  );
  if (!out) return null;
  const at = (i: number): Vec3 => [out[i]!, out[i + 1]!, out[i + 2]!];
  return [
    [at(0), at(3)],
    [at(6), at(9)],
  ];
}
