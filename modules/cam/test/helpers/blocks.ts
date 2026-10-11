import type { ServerBody } from "@rockett/plugin-api";
import { box, brep, cut, cylinder, oc, scoped, type Own } from "./kernel.js";

export const blockSetup = {
  bodies: ["b1"],
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 2 },
  },
  wcs: {
    origin: {
      kind: "stockCorner" as const,
      x: "min" as const,
      y: "min" as const,
      z: "max" as const,
    },
    axes: { x: "+x" as const, z: "+z" as const },
    offsetIndex: 1,
    machine: { kind: "unknown" as const },
  },
};

function roundedPocket(own: Own) {
  const at = (x: number, y: number) => own(new oc.gp_Pnt_3(x, y, 12));
  const up = own(new oc.gp_Dir_5(0, 0, 1));
  const wire = own(new oc.BRepBuilderAPI_MakeWire_1());
  const line = (a: number[], b: number[]) =>
    own(new oc.BRepBuilderAPI_MakeEdge_3(at(a[0]!, a[1]!), at(b[0]!, b[1]!)));
  const arc = (c: number[], a: number[], b: number[]) =>
    own(
      new oc.BRepBuilderAPI_MakeEdge_10(
        own(new oc.gp_Circ_2(own(new oc.gp_Ax2_4(at(c[0]!, c[1]!), up)), 3)),
        at(a[0]!, a[1]!),
        at(b[0]!, b[1]!),
      ),
    );
  for (const made of [
    line([13, 10], [27, 10]),
    arc([27, 13], [27, 10], [30, 13]),
    line([30, 13], [30, 37]),
    arc([27, 37], [30, 37], [27, 40]),
    line([27, 40], [13, 40]),
    arc([13, 37], [13, 40], [10, 37]),
    line([10, 37], [10, 13]),
    arc([13, 13], [10, 13], [13, 10]),
  ])
    wire.Add_1(own(made.Edge()));
  const face = own(
    own(new oc.BRepBuilderAPI_MakeFace_15(own(wire.Wire()), true)).Face(),
  );
  return own(
    own(
      new oc.BRepPrimAPI_MakePrism_1(
        face,
        own(new oc.gp_Vec_4(0, 0, 9)),
        false,
        true,
      ),
    ).Shape(),
  );
}

function faceCount(text: string) {
  return scoped((own) => {
    const shape = own(new oc.TopoDS_Shape());
    const file = `/rockett-cam-features-${crypto.randomUUID()}.brep`;
    oc.FS.writeFile(file, text);
    oc.BRepTools.Read_2(
      shape,
      file,
      own(new oc.BRep_Builder()),
      own(new oc.Message_ProgressRange_1()),
    );
    oc.FS.unlink(file);
    const found = own(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    let count = 0;
    for (; found.More(); found.Next()) count++;
    return count;
  });
}

export const blockBody = (text: string, max: number[]): ServerBody => ({
  id: "b1",
  name: "Block",
  bbox: { min: [0, 0, 0], max } as ServerBody["bbox"],
  brep: text,
  faceNames: Array.from({ length: faceCount(text) }, (_, i) => `f:block:${i}`),
  fingerprint: "f".repeat(64),
});

export const featureBlock = () =>
  blockBody(
    brep((own) => {
      const block = box(own, [0, 0, 0], [80, 60, 20]);
      const pocketed = cut(own, block, roundedPocket(own));
      const drilled = cut(
        own,
        pocketed,
        cylinder(own, [60, 30, -1], [0, 0, 1], 3, 22),
      );
      return cut(own, drilled, box(own, [70, 0, 15], [10, 60, 5]));
    }),
    [80, 60, 20],
  );

export const openedBlock = () =>
  blockBody(
    brep((own) => {
      const block = box(own, [0, 0, 0], [60, 40, 10]);
      const opened = cut(own, block, box(own, [5, 10, -1], [10, 20, 12]));
      const rebated = cut(own, opened, box(own, [50, -1, -1], [11, 42, 4]));
      const cavity = cut(own, rebated, box(own, [20, 5, 2], [20, 10, 4]));
      return cut(own, cavity, box(own, [28, 8, 5], [4, 4, 6]));
    }),
    [60, 40, 10],
  );
