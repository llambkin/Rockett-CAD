import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { edges, getKernel, pnt, progress } from "../../src/geometry/kernel.js";
import { sha256 } from "../../src/store/jsonStore.js";

export const stepSources = new Map<string, Buffer>();

export function withStepBlobs(features: Array<Record<string, unknown>>) {
  return features.map(({ data, ...feature }) =>
    feature.type === "importStep"
      ? {
          ...feature,
          blob: sha256(Buffer.from(String(data), "utf8")),
        }
      : { ...feature, ...(data !== undefined && { data }) },
  );
}

export function stepBlob(text: string): string {
  const bytes = Buffer.from(text, "utf8"),
    hash = sha256(bytes);
  stepSources.set(hash, bytes);
  return hash;
}

function writeStep(shapes: any[], file: string): string {
  const k = getKernel(),
    writer = new k.STEPControl_Writer_1();
  try {
    for (const shape of shapes)
      writer.Transfer(
        shape,
        k.STEPControl_StepModelType.STEPControl_AsIs,
        true,
        progress(),
      );
    if (writer.Write(file) !== k.IFSelect_ReturnStatus.IFSelect_RetDone)
      throw new Error("fixture export failed");
    return k.FS.readFile(file, { encoding: "utf8" });
  } finally {
    writer.delete();
    if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
  }
}

export function stepFixture(twoBodies = false): string {
  const k = getKernel(),
    boxes = [new k.BRepPrimAPI_MakeBox_2(20, 30, 10)];
  if (twoBodies) boxes.push(new k.BRepPrimAPI_MakeBox_2(5, 6, 7));
  try {
    return writeStep(
      boxes.map((b) => b.Shape()),
      "/fixture.step",
    );
  } finally {
    for (const box of boxes) box.delete();
  }
}

const LARGE_STEP_VERSION = 1;
const LARGE_BOX = 10;
const LARGE_PITCH = 15;
const LARGE_RADIUS = 1;

function filletedBox(i: number, columns: number): any {
  const k = getKernel(),
    corner = pnt(
      (i % columns) * LARGE_PITCH,
      Math.floor(i / columns) * LARGE_PITCH,
      0,
    ),
    box = new k.BRepPrimAPI_MakeBox_3(corner, LARGE_BOX, LARGE_BOX, LARGE_BOX),
    fillet = new k.BRepFilletAPI_MakeFillet(
      box.Shape(),
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    );
  try {
    for (const edge of edges(box.Shape())) fillet.Add_2(LARGE_RADIUS, edge);
    fillet.Build(progress());
    if (!fillet.IsDone()) throw new Error("fixture fillet failed");
    return fillet.Shape();
  } finally {
    fillet.delete();
    box.delete();
    corner.delete();
  }
}

export function largeStepFixture(count: number): string {
  const cache = join(
    tmpdir(),
    `rockett-large-step-v${LARGE_STEP_VERSION}-${count}.step`,
  );
  if (existsSync(cache)) return readFileSync(cache, "utf8");
  const columns = Math.ceil(Math.sqrt(count)),
    shapes = Array.from({ length: count }, (_, i) => filletedBox(i, columns));
  try {
    const text = writeStep(shapes, "/large-fixture.step"),
      partial = `${cache}.${process.pid}`;
    writeFileSync(partial, text);
    renameSync(partial, cache);
    return text;
  } finally {
    for (const shape of shapes) shape.delete();
  }
}
