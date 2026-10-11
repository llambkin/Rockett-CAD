import type { KernelJobScope } from "@rockett/plugin-api";
import type { Placement } from "../../src/shared/setup.js";

export type OC = KernelJobScope["oc"];
export type Own = KernelJobScope["own"];
export type Shape = { delete(): void };

export const SAME: Placement = {
  rotation: [0, 0, 0, 1],
  translation: [0, 0, 0],
};

const core = (file: string) =>
  import(new URL(`../../../../server/src/${file}`, import.meta.url).href);

export let oc: OC;
export let scoped: <T>(fn: (own: Own) => T) => T;
let kernel: {
  moduleJob(entry: string, id: string, input: unknown): Promise<unknown>;
};

export async function startKernel() {
  const [geometry, client] = await Promise.all([
    core("geometry/kernel.ts"),
    core("kernel/client.ts"),
  ]);
  kernel = await client.InProcessKernel.start({
    sources: async () => new Map(),
  });
  oc = geometry.getKernel();
  scoped = geometry.scoped;
}

export const moduleJob = (entry: string, id: string, input: unknown) =>
  kernel.moduleJob(entry, id, input);

export function brep(make: (own: Own) => Shape): string {
  const file = `/rockett-cam-test-${crypto.randomUUID()}.brep`;
  try {
    scoped((own) =>
      oc.BRepTools.Write_3(
        make(own),
        file,
        own(new oc.Message_ProgressRange_1()),
      ),
    );
    return oc.FS.readFile(file, { encoding: "utf8" });
  } finally {
    if (oc.FS.analyzePath(file).exists) oc.FS.unlink(file);
  }
}

export function cut(own: Own, body: Shape, tool: Shape): Shape {
  const op = own(
    new oc.BRepAlgoAPI_Cut_3(body, tool, own(new oc.Message_ProgressRange_1())),
  );
  return own(op.Shape());
}

export function fuse(own: Own, body: Shape, tool: Shape): Shape {
  const op = own(
    new oc.BRepAlgoAPI_Fuse_3(
      body,
      tool,
      own(new oc.Message_ProgressRange_1()),
    ),
  );
  return own(op.Shape());
}

export function box(own: Own, at: [number, number, number], size: number[]) {
  const corner = own(new oc.gp_Pnt_3(...at));
  return own(
    own(
      new oc.BRepPrimAPI_MakeBox_3(corner, size[0], size[1], size[2]),
    ).Shape(),
  );
}

export function cylinder(
  own: Own,
  at: number[],
  axis: number[],
  r: number,
  height = 20,
) {
  const frame = own(
    new oc.gp_Ax2_4(
      own(new oc.gp_Pnt_3(at[0], at[1], at[2])),
      own(new oc.gp_Dir_5(axis[0], axis[1], axis[2])),
    ),
  );
  return own(own(new oc.BRepPrimAPI_MakeCylinder_3(frame, r, height)).Shape());
}
