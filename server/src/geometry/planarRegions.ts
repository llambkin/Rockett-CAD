import {
  faces,
  getKernel,
  isValidShape,
  scoped,
  type Shape,
} from "./kernel.js";

export function cutPlanarRegions(face: Shape, regions: Shape[]): Shape {
  return scoped((own) => {
    const k = getKernel();
    const range = own(new k.Message_ProgressRange_1());
    if (regions.length === 0) throw new Error("no sketch regions to subtract");
    const builder = own(new k.BRep_Builder());
    const compound = own(new k.TopoDS_Compound());
    builder.MakeCompound(compound);
    for (const region of regions) builder.Add(compound, region);
    const direct = subtractRegions(face, compound);
    if (direct) return direct;
    let tool = regions[0];
    for (const region of regions.slice(1)) {
      const join = own(new k.BRepAlgoAPI_Fuse_3(tool, region, range));
      join.Build(range);
      if (!join.IsDone()) throw new Error("failed to merge sketch regions");
      tool = own(join.Shape());
    }
    const unify = own(
      new k.ShapeUpgrade_UnifySameDomain_2(tool, true, true, false),
    );
    unify.Build();
    tool = own(unify.Shape());
    const repaired = subtractRegions(face, tool);
    if (repaired) return repaired;
    throw new Error("sketch regions do not form one valid planar face");
  });
}

function subtractRegions(face: Shape, tool: Shape): Shape | null {
  return scoped((own) => {
    const k = getKernel();
    const range = own(new k.Message_ProgressRange_1());
    const cut = own(new k.BRepAlgoAPI_Cut_3(face, tool, range));
    cut.Build(range);
    if (!cut.IsDone()) throw new Error("failed to subtract sketch regions");
    const result = own(cut.Shape());
    const found = faces(result);
    if (found.length === 1 && isValidShape(found[0])) return found[0];
    for (const part of found) part.delete();
    return null;
  });
}
