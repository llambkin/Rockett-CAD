import crypto from "node:crypto";
import {
  acquire,
  getKernel,
  HandleScope,
  transformOp,
  type Shape,
} from "./kernel.js";

interface XdePart {
  shape: Shape;
  name: string;
  color?: string | undefined;
}

interface XdeBody {
  name: string | null;
  color?: string;
  path: Array<string | null>;
  shape: Shape;
}

export type XdeNode =
  | { name: string | null; body: number }
  | { name: string | null; children: XdeNode[] };

function session(ext: "step" | "glb") {
  const k = getKernel();
  const scope = new HandleScope();
  const own = scope.acquire;
  const file = `/rockett-xde-${crypto.randomUUID()}.${ext}`;
  own({
    delete: () => {
      if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
    },
  });
  const app = own(k.XCAFApp_Application.GetApplication());
  const newDocument = () => {
    const doc = own(new k.Handle_TDocStd_Document_1());
    app
      .get()
      .NewDocument_2(
        own(new k.TCollection_ExtendedString_2("MDTV-XCAF", true)),
        doc,
      );
    own({ delete: () => app.get().Close(doc) });
    const main = own(doc.get().Main());
    const tool = (name: string) =>
      own(k.XCAFDoc_DocumentTool[name](main)).get();
    return { doc, shapes: tool("ShapeTool"), colours: tool("ColorTool") };
  };
  const labels = (fill: (seq: unknown) => void): any[] => {
    const seq = own(new k.TDF_LabelSequence_1());
    fill(seq);
    return Array.from({ length: seq.Length() }, (_, i) =>
      own(seq.Value_2(i + 1)),
    );
  };
  const progress = () => own(new k.Message_ProgressRange_1());
  const close = (failed = false) => scope.close(failed);
  return {
    k,
    own,
    keep: scope.keep,
    file,
    newDocument,
    labels,
    progress,
    close,
  };
}

type Session = ReturnType<typeof session>;

function inSession<T>(ext: "step" | "glb", run: (xde: Session) => T): T {
  const xde = session(ext);
  let failed = true;
  try {
    const result = run(xde);
    failed = false;
    return result;
  } finally {
    xde.close(failed);
  }
}

function toColour({ k, own }: Session, hex: string) {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  return own(
    new k.Quantity_Color_3(r, g, b, k.Quantity_TypeOfColor.Quantity_TOC_sRGB),
  );
}

function fromColour({ k }: Session, colour: any): string {
  const byte = (linear: number) =>
    Math.round(k.Quantity_Color.Convert_LinearRGB_To_sRGB_1(linear) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(colour.Red())}${byte(colour.Green())}${byte(colour.Blue())}`;
}

function unlocated({ k, own }: Session, shape: Shape): Shape {
  const location = own(shape.Location_1());
  if (location.IsIdentity()) return shape;
  const origin = own(shape.Located(own(new k.TopLoc_Location_1()), false));
  return own(own(transformOp(origin, own(location.Transformation()))).Shape());
}

const directive =
  (code: string, digits: number) =>
  (run: string): string =>
    `\\${code}\\${Array.from(run, (c) =>
      c.codePointAt(0)!.toString(16).toUpperCase().padStart(digits, "0"),
    ).join("")}\\X0\\`;

function basicAlphabet(utf8: Uint8Array): Buffer {
  return Buffer.from(
    Buffer.from(utf8)
      .toString("utf8")
      .replace(/[\u0080-\uffff]+/gu, directive("X2", 4))
      .replace(/[\u{10000}-\u{10ffff}]+/gu, directive("X4", 8)),
    "ascii",
  );
}

function buildXdeDocument(xde: Session, parts: readonly XdePart[]) {
  const { k, own } = xde;
  const { doc, shapes, colours } = xde.newDocument();
  for (const { shape, name, color } of parts) {
    const label = own(shapes.AddShape(unlocated(xde, shape), false, true));
    k.setLabelName(label, name.replaceAll("\0", ""));
    if (color)
      colours.SetColor_2(
        label,
        toColour(xde, color),
        k.XCAFDoc_ColorType.XCAFDoc_ColorGen,
      );
  }
  return doc;
}

export function writeXdeStep(parts: readonly XdePart[]): Buffer {
  return inSession("step", (xde) => {
    const { k, own } = xde;
    const doc = buildXdeDocument(xde, parts);
    const writer = own(new k.STEPCAFControl_Writer_1());
    writer.SetColorMode(true);
    writer.SetNameMode(true);
    const done =
      writer.Transfer_1(
        doc,
        k.STEPControl_StepModelType.STEPControl_AsIs,
        null,
        xde.progress(),
      ) && writer.Write(xde.file) === k.IFSelect_ReturnStatus.IFSelect_RetDone;
    if (!done) throw new Error("STEP export failed in the kernel");
    return basicAlphabet(k.FS.readFile(xde.file) as Uint8Array);
  });
}

export function writeXdeGlb(
  parts: readonly XdePart[],
  { linear, angular }: { linear: number; angular: number },
): Buffer {
  return inSession("glb", (xde) => {
    const { k, own } = xde;
    const metre = 0.001;
    const yUp = own(new k.gp_Trsf_1());
    yUp.SetValues(metre, 0, 0, 0, 0, 0, metre, 0, 0, -metre, 0, 0);
    const meshed = parts.map((part) => {
      const placed = unlocated(xde, part.shape);
      const shape = own(own(transformOp(placed, yUp)).Shape());
      own(
        new k.BRepMesh_IncrementalMesh_2(
          shape,
          linear * metre,
          false,
          angular,
          false,
        ),
      );
      return { ...part, shape };
    });
    const doc = buildXdeDocument(xde, meshed);
    const writer = own(
      new k.RWGltf_CafWriter(
        own(new k.TCollection_AsciiString_2(xde.file)),
        true,
      ),
    );
    writer.SetMergeFaces(true);
    const done = writer.Perform_2(
      doc,
      own(new k.TColStd_IndexedDataMapOfStringString_1()),
      xde.progress(),
    );
    if (!done) throw new Error("glTF export failed in the kernel");
    return Buffer.from(k.FS.readFile(xde.file) as Uint8Array);
  });
}

export function readXdeStep(bytes: Uint8Array): {
  bodies: XdeBody[];
  tree: XdeNode[];
} {
  return inSession("step", (xde) => {
    const { k, own } = xde;
    const ST = k.XCAFDoc_ShapeTool;
    const bodies: XdeBody[] = [];
    const colourOf = (...labels: any[]) => {
      const colour = own(new k.Quantity_Color_1());
      const found = labels.some((label) =>
        [
          k.XCAFDoc_ColorType.XCAFDoc_ColorSurf,
          k.XCAFDoc_ColorType.XCAFDoc_ColorGen,
        ].some((type) => k.XCAFDoc_ColorTool.GetColor_4(label, type, colour)),
      );
      return found ? fromColour(xde, colour) : undefined;
    };
    const walk = (
      label: any,
      name: string | null,
      path: Array<string | null>,
      location: any,
      instance?: any,
    ): XdeNode => {
      if (ST.IsAssembly(label))
        return {
          name,
          children: xde
            .labels((seq) => ST.GetComponents(label, seq, false))
            .map((component) => {
              const part = own(new k.TDF_Label());
              ST.GetReferredShape(component, part);
              const named = k.labelName(component);
              const placed = own(
                location.Multiplied(own(ST.GetLocation(component))),
              );
              return walk(part, named, [...path, named], placed, component);
            }),
        };
      const color = colourOf(...(instance ? [instance] : []), label);
      bodies.push({
        name: k.labelName(label),
        ...(color ? { color } : {}),
        path,
        shape: own(own(ST.GetShape_2(label)).Moved(location, false)),
      });
      return { name, body: bodies.length - 1 };
    };
    k.FS.writeFile(xde.file, bytes);
    const reader = own(new k.STEPCAFControl_Reader_1());
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    const { doc, shapes } = xde.newDocument();
    const read =
      reader.ReadFile_1(xde.file) ===
        k.IFSelect_ReturnStatus.IFSelect_RetDone &&
      reader.Transfer_1(doc, xde.progress());
    if (!read) throw new Error("STEP file could not be read");
    const tree = xde
      .labels((seq) => shapes.GetFreeShapes(seq))
      .map((label) => {
        const name = k.labelName(label);
        return walk(label, name, [name], own(new k.TopLoc_Location_1()));
      });
    for (const body of bodies) body.shape = acquire(xde.keep(body.shape));
    return { bodies, tree };
  });
}
