import crypto from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { getKernel, initKernel, volumeOf } from "../src/geometry/kernel.js";

beforeAll(initKernel, 120_000);

const round = (x: number) => Math.round(x * 1e6) / 1e6;

it("round-trips named, coloured parts and an assembly through XDE", () => {
  const k = getKernel();
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(o: T): T => {
    owned.push(o);
    return o;
  };
  const opened: unknown[] = [];
  const id = crypto.randomUUID();
  const stepFile = `/rockett-xde-${id}.step`;
  const glbFile = `/rockett-xde-${id}.glb`;
  const app = own(k.XCAFApp_Application.GetApplication());
  const text = (s: string) => own(new k.TCollection_ExtendedString_2(s, true));
  const fromExt = (e: unknown) => {
    const ascii = own(new k.TCollection_AsciiString_13(e, 63));
    return ascii.ToCString() as string;
  };
  const newDocument = () => {
    const doc = own(new k.Handle_TDocStd_Document_1());
    app.get().NewDocument_2(text("MDTV-XCAF"), doc);
    opened.push(doc);
    const main = own(doc.get().Main());
    const tool = (name: string) =>
      own(k.XCAFDoc_DocumentTool[name](main)).get();
    return {
      doc,
      shapes: tool("ShapeTool"),
      colours: tool("ColorTool"),
      layers: tool("LayerTool"),
    };
  };
  const nameOf = (label: any) => {
    const attr = own(new k.Handle_TDF_Attribute_1());
    const found = label.FindAttribute_1(own(k.TDataStd_Name.GetID()), attr);
    return found ? fromExt(own(attr.get().Get())) : null;
  };
  const labels = (fill: (seq: any) => void) => {
    const seq = own(new k.TDF_LabelSequence_1());
    fill(seq);
    return Array.from({ length: seq.Length() }, (_, i) =>
      own(seq.Value(i + 1)),
    );
  };
  const rgb = (r: number, g: number, b: number) =>
    own(
      new k.Quantity_Color_3(r, g, b, k.Quantity_TypeOfColor.Quantity_TOC_RGB),
    );
  const at = (x: number) => {
    const trsf = own(new k.gp_Trsf_1());
    trsf.SetTranslation_1(own(new k.gp_Vec_4(x, 0, 0)));
    return own(new k.TopLoc_Location_2(trsf));
  };
  const { Gen, Surf } = {
    Gen: k.XCAFDoc_ColorType.XCAFDoc_ColorGen,
    Surf: k.XCAFDoc_ColorType.XCAFDoc_ColorSurf,
  };
  const ST = k.XCAFDoc_ShapeTool;

  try {
    const out = newDocument();
    const plate = own(own(new k.BRepPrimAPI_MakeBox_2(10, 20, 30)).Shape());
    const cube = own(own(new k.BRepPrimAPI_MakeBox_2(5, 5, 5)).Shape());
    const plateL = own(out.shapes.AddShape(plate, false, true));
    const cubeL = own(out.shapes.AddShape(cube, false, true));
    own(k.TDataStd_Name.Set_1(plateL, text("Plate")));
    own(k.TDataStd_Name.Set_1(cubeL, text("Cube")));
    out.colours.SetColor_2(plateL, rgb(1, 0, 0), Gen);
    out.colours.SetColor_2(cubeL, rgb(0, 0.5, 1), Gen);
    out.layers.SetLayer_2(cubeL, text("Hardware"), true);
    const asm = own(out.shapes.NewShape());
    own(k.TDataStd_Name.Set_1(asm, text("Assembly")));
    for (const [part, x, name] of [
      [plateL, 0, "Plate-1"],
      [plateL, 50, "Plate-2"],
      [cubeL, 100, "Cube-1"],
    ] as const) {
      const comp = own(out.shapes.AddComponent_1(asm, part, at(x)));
      own(k.TDataStd_Name.Set_1(comp, text(name)));
    }
    out.shapes.UpdateAssemblies();

    const writer = own(new k.STEPCAFControl_Writer_1());
    writer.SetColorMode(true);
    writer.SetNameMode(true);
    writer.SetLayerMode(true);
    expect(
      writer.Transfer_1(
        out.doc,
        k.STEPControl_StepModelType.STEPControl_AsIs,
        null,
        own(new k.Message_ProgressRange_1()),
      ),
    ).toBe(true);
    expect(writer.Write(stepFile)).toBe(
      k.IFSelect_ReturnStatus.IFSelect_RetDone,
    );
    const step: string = k.FS.readFile(stepFile, { encoding: "utf8" });
    expect(step.match(/PRODUCT\('[^']*'/g)).toEqual([
      "PRODUCT('Assembly'",
      "PRODUCT('Plate'",
      "PRODUCT('Cube'",
    ]);
    expect(step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)).toHaveLength(3);
    expect(step).toContain("SI_UNIT(.MILLI.,.METRE.)");
    expect(step).toContain("PRESENTATION_LAYER_ASSIGNMENT('Hardware'");
    expect(step.match(/COLOUR_RGB\([^)]*\)/g)).toEqual([
      "COLOUR_RGB('',0.,0.735356983052,1.)",
    ]);
    expect(step.match(/DRAUGHTING_PRE_DEFINED_COLOUR\([^)]*\)/g)).toEqual([
      "DRAUGHTING_PRE_DEFINED_COLOUR('red')",
    ]);

    const reader = own(new k.STEPCAFControl_Reader_1());
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    reader.SetLayerMode(true);
    expect(reader.ReadFile(stepFile)).toBe(
      k.IFSelect_ReturnStatus.IFSelect_RetDone,
    );
    const back = newDocument();
    expect(
      reader.Transfer_1(back.doc, own(new k.Message_ProgressRange_1())),
    ).toBe(true);
    const tree = labels((s) => back.shapes.GetFreeShapes(s)).map((top) => ({
      name: nameOf(top),
      assembly: ST.IsAssembly(top),
      components: labels((s) => ST.GetComponents(top, s, false)).map((c) => {
        const part = own(new k.TDF_Label());
        ST.GetReferredShape(c, part);
        const colour = own(new k.Quantity_Color_1());
        const surf = back.colours.GetColor_4(part, Surf, colour);
        const move = own(
          own(own(ST.GetLocation(c)).Transformation()).TranslationPart(),
        );
        return {
          name: nameOf(c),
          part: nameOf(part),
          at: [move.X(), move.Y(), move.Z()],
          gen: back.colours.GetColor_4(
            part,
            Gen,
            own(new k.Quantity_Color_1()),
          ),
          surf,
          colour: [colour.Red(), colour.Green(), colour.Blue()].map(round),
          layers: labels((s) => back.layers.GetLayers_2(part, s)).map((l) => {
            const layer = own(new k.TCollection_ExtendedString_1());
            back.layers.GetLayer(l, layer);
            return fromExt(layer);
          }),
          volume: round(volumeOf(own(ST.GetShape_2(part)))),
        };
      }),
    }));
    expect(tree).toEqual([
      {
        name: "Assembly",
        assembly: true,
        components: [
          {
            name: "Plate-1",
            part: "Plate",
            at: [0, 0, 0],
            gen: false,
            surf: true,
            colour: [1, 0, 0],
            layers: [],
            volume: 6000,
          },
          {
            name: "Plate-2",
            part: "Plate",
            at: [50, 0, 0],
            gen: false,
            surf: true,
            colour: [1, 0, 0],
            layers: [],
            volume: 6000,
          },
          {
            name: "Cube-1",
            part: "Cube",
            at: [100, 0, 0],
            gen: false,
            surf: true,
            colour: [0, 0.5, 1],
            layers: ["Hardware"],
            volume: 125,
          },
        ],
      },
    ]);

    own(new k.BRepMesh_IncrementalMesh_2(plate, 0.1, false, 0.5, false));
    own(new k.BRepMesh_IncrementalMesh_2(cube, 0.1, false, 0.5, false));
    const gltf = own(
      new k.RWGltf_CafWriter(
        own(new k.TCollection_AsciiString_2(glbFile)),
        true,
      ),
    );
    expect(
      gltf.Perform_2(
        out.doc,
        own(new k.TColStd_IndexedDataMapOfStringString_1()),
        own(new k.Message_ProgressRange_1()),
      ),
    ).toBe(true);
    const glb = Buffer.from(k.FS.readFile(glbFile) as Uint8Array);
    expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
    const json = JSON.parse(
      glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    );
    expect({
      nodes: json.nodes.map((n: any) => [n.name, n.mesh ?? null]),
      meshes: json.meshes.length,
      materials: json.materials.map((m: any) =>
        m.pbrMetallicRoughness.baseColorFactor.map(round),
      ),
    }).toEqual({
      nodes: [
        ["Assembly", null],
        ["Plate-1", 0],
        ["Plate-2", 1],
        ["Cube-1", 2],
      ],
      meshes: 3,
      materials: [
        [1, 0, 0, 1],
        [0, 0.5, 1, 1],
      ],
    });
  } finally {
    for (const doc of opened) app.get().Close(doc);
    for (let o = owned.pop(); o; o = owned.pop()) o.delete();
    for (const f of [stepFile, glbFile])
      if (k.FS.analyzePath(f).exists) k.FS.unlink(f);
  }
});
