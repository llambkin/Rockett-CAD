import { readFileSync } from "node:fs";
import type { Vec3 } from "@rockett/shared";

type Exports = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  buffer(): number;
  fillet_planes(): number;
};

export type PlaneSide = { normal: Vec3; into: Vec3 };
export type FilletSection = { centre: Vec3; contacts: [Vec3, Vec3] };

let compiled: WebAssembly.Module | undefined;

export function blendModule(): WebAssembly.Module {
  compiled ??= new WebAssembly.Module(
    readFileSync(
      new URL("../../../modules/kernel/blend/blend.wasm", import.meta.url),
    ),
  );
  return compiled;
}

function call(module: WebAssembly.Module, input: number[]) {
  const wasm = new WebAssembly.Instance(module, {}).exports as Exports;
  try {
    wasm["_initialize"]();
    const io = new Float64Array(wasm.memory.buffer, wasm.buffer(), 37);
    io.set(input);
    const status = wasm.fillet_planes();
    return status === 0 ? Array.from(io.subarray(input.length)) : null;
  } catch (error) {
    if (!(error instanceof WebAssembly.RuntimeError)) throw error;
    throw new Error(`the blend module stopped (${error.message})`, {
      cause: error,
    });
  }
}

export function filletBetweenPlanes(
  edge: [Vec3, Vec3],
  sides: [PlaneSide, PlaneSide],
  radius: number,
): [FilletSection, FilletSection] | null {
  const [a, b] = sides;
  const out = call(blendModule(), [
    ...edge[0],
    ...edge[1],
    ...a.normal,
    ...a.into,
    ...b.normal,
    ...b.into,
    radius,
  ]);
  if (!out) return null;
  const at = (i: number): Vec3 => [out[i]!, out[i + 1]!, out[i + 2]!];
  const section = (i: number): FilletSection => ({
    centre: at(i),
    contacts: [at(i + 3), at(i + 6)],
  });
  return [section(0), section(9)];
}
