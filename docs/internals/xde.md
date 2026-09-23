# XDE in the pinned opencascade.js build

Probe of `opencascade.js` 2.0.0-beta.b5ff984, run by
`server/test/xdeProbe.test.ts` (`npm test -w server -- xdeProbe`). Every class
the typings declare for XDE binds and works at runtime: `STEPCAFControl_Reader`,
`STEPCAFControl_Writer`, `XCAFApp_Application`, `XCAFDoc_ShapeTool`,
`XCAFDoc_ColorTool`, `XCAFDoc_LayerTool`, `TDataStd_Name` and
`RWGltf_CafWriter`. One binding failed: `TCollection_ExtendedString.Value`
throws `UnboundTypeError`, so strings are read another way (below).

## Fixture

Two boxes: `Plate` (10 x 20 x 30 mm, red) and `Cube` (5 mm, linear RGB
0, 0.5, 1, layer `Hardware`). An `Assembly` holds `Plate-1` at x 0, `Plate-2`
at x 50 and `Cube-1` at x 100. Files go through the kernel's in-memory file
system at a unique `/rockett-xde-<uuid>` path, the pattern `readStep` uses, and
are unlinked afterwards.

## Build a document

1. `XCAFApp_Application.GetApplication()` returns a handle; `.get()` is the
   application.
2. `app.NewDocument_2(new TCollection_ExtendedString_2("MDTV-XCAF", true), doc)`
   fills `doc = new Handle_TDocStd_Document_1()`.
3. `doc.get().Main()` gives the main label. `XCAFDoc_DocumentTool.ShapeTool`,
   `.ColorTool` and `.LayerTool` on it return handles; `.get()` is the tool.
4. `shapes.AddShape(shape, false, true)` adds each part and returns its label.
5. `TDataStd_Name.Set_1(label, extendedString)` names a part, the assembly or
   a component.
6. `colours.SetColor_2(label, new Quantity_Color_3(r, g, b, Quantity_TOC_RGB), XCAFDoc_ColorGen)`
   colours a part.
7. `layers.SetLayer_2(label, extendedString, true)` puts a part on a layer.
8. `shapes.NewShape()` makes the assembly label.
   `shapes.AddComponent_1(assembly, part, new TopLoc_Location_2(trsf))` adds
   an instance, with `trsf` from `gp_Trsf_1.SetTranslation_1(gp_Vec_4)`.
9. `shapes.UpdateAssemblies()` builds the assembly compounds.

## Write STEP

`new STEPCAFControl_Writer_1()`, then `SetColorMode`, `SetNameMode` and
`SetLayerMode` true, then
`Transfer_1(doc, STEPControl_AsIs, null, new Message_ProgressRange_1())` and
`Write(path)`, which returns `IFSelect_RetDone`.

Pass `null` as the third argument. An exploratory run that passed `""` wrote
each part to its own file, named after the part, beside the main file.

The written file, as pinned:

- `PRODUCT` entries for `Assembly`, `Plate` and `Cube`, in that order.
- Three `NEXT_ASSEMBLY_USAGE_OCCURRENCE` entries, one per instance.
- `SI_UNIT(.MILLI.,.METRE.)` lengths.
- `PRESENTATION_LAYER_ASSIGNMENT('Hardware'`.
- Red as `DRAUGHTING_PRE_DEFINED_COLOUR('red')`. The other colour as
  `COLOUR_RGB('',0.,0.735356983052,1.)`: the writer stores sRGB, so linear
  0.5 becomes 0.7354.

## Read STEP

`new STEPCAFControl_Reader_1()`, then `SetColorMode`, `SetNameMode` and
`SetLayerMode` true, `ReadFile(path)` returns `IFSelect_RetDone`, and
`Transfer_1(doc, new Message_ProgressRange_1())` fills a fresh document made
as above. No length unit is set; volumes read back in mm.

Walk the result:

- `shapes.GetFreeShapes(seq)` into `new TDF_LabelSequence_1()`: one label,
  `Assembly`. The parts are not free.
- `XCAFDoc_ShapeTool.IsAssembly(label)`: true.
- `XCAFDoc_ShapeTool.GetComponents(label, seq, false)`: three components in
  write order.
- `XCAFDoc_ShapeTool.GetReferredShape(component, part)` fills
  `part = new TDF_Label()`.
- `XCAFDoc_ShapeTool.GetLocation(component).Transformation().TranslationPart()`
  gives the placement: x 0, 50 and 100.
- `XCAFDoc_ShapeTool.GetShape_2(part)` gives the solid: volumes 6000 and 125.
- `colours.GetColor_4(part, type, new Quantity_Color_1())` finds the colour
  under `XCAFDoc_ColorSurf`, not the `XCAFDoc_ColorGen` it was written with.
  `Red()`, `Green()` and `Blue()` return the linear values written: 1, 0, 0
  and 0, 0.5, 1 to six decimals.
- `layers.GetLayers_2(part, seq)` then `layers.GetLayer(layerLabel, string)`:
  `Hardware` on `Cube`, none on `Plate`.

Names read back as written: component names `Plate-1`, `Plate-2` and `Cube-1`
and part names `Plate` and `Cube`. An exploratory run that did not name the
components read them back as the writer's instance description, for example
`=>[0:1:1:1]`.

## Read a name

`label.FindAttribute_1(TDataStd_Name.GetID(), attr)` with
`attr = new Handle_TDF_Attribute_1()`. On success `attr.get()` is already a
`TDataStd_Name`, and `.Get()` returns a `TCollection_ExtendedString`. Convert
it with `new TCollection_AsciiString_13(ext, 63).ToCString()`, where 63
replaces non-ASCII characters with `?`.

## Write glTF

After `new BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false)` on each
part, `new RWGltf_CafWriter(new TCollection_AsciiString_2(path), true)` and
`Perform_2(doc, new TColStd_IndexedDataMapOfStringString_1(), new Message_ProgressRange_1())`
return true. The file starts with `glTF`. Its nodes are `Assembly`, `Plate-1`,
`Plate-2` and `Cube-1`, with three meshes, one per instance, so the two `Plate`
instances do not share a mesh. Material base colours are `[1, 0, 0, 1]` and
`[0, 0.5, 1, 1]`.

## Ownership

Every object built with `new` or returned by value is deleted with `.delete()`,
including labels from `Main()`, `AddShape`, `AddComponent_1` and
`TDF_LabelSequence.Value`, handles from the static tool getters and
`TDataStd_Name.Set_1`, and the copies returned by `Get()`, `GetID()`,
`GetLocation()` and `GetShape_2()`. Results of a handle's `.get()` are
borrowed and never deleted. Each document is closed with `app.Close(doc)`
before its handle is deleted.
