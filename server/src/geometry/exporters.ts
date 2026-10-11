/**
 * Mesh exporters: binary STL and 3MF.
 *
 * Both operate on fresh tessellations of the B-Rep bodies at export quality
 * (independent of the viewport tessellation).
 *
 * 3MF is written directly (OPC zip + 3D/3dmodel.model XML); each body is a
 * separate <object> so multi-body models survive into slicers.
 */

import { zipSync, strToU8 } from "fflate";
import {
  bodyName,
  createRegistry,
  LINEAR_TOL,
  ValidationError,
  type CadDocument,
  type ExportFormat,
} from "@rockett/shared";
import { writeDxf, type Drawing } from "./dxf.js";
import { meshCopy } from "./mesh.js";
import type { NamedBody } from "./naming.js";
import { writeXdeGlb, writeXdeStep } from "./xde.js";

export const EXPORT_QUALITY = 0.05;

interface Mesh {
  positions: number[];
  indices: number[];
}

const tolerance = (quality: number) => ({
  linear: quality,
  angular: 0.3 * Math.sqrt(quality / EXPORT_QUALITY),
});

/** Tessellate a body at export quality. */
export function exportMesh(body: NamedBody, quality = EXPORT_QUALITY): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of meshCopy(body.shape, tolerance(quality))) {
    const offset = positions.length / 3;
    for (const p of m.positions) positions.push(p);
    for (const i of m.indices) indices.push(offset + i);
  }
  return { positions, indices };
}

/** Binary STL of one or more bodies merged into a single mesh. */
export function writeStl(
  bodies: NamedBody[],
  quality = EXPORT_QUALITY,
): Buffer {
  const meshes = bodies.map((b) => exportMesh(b, quality));
  const triCount = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const buffer = Buffer.alloc(84 + triCount * 50);
  buffer.write("Rockett CAD binary STL (units: mm)", 0, "ascii");
  buffer.writeUInt32LE(triCount, 80);
  let off = 84;
  for (const mesh of meshes) {
    const { positions: P, indices: I } = mesh;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]! * 3,
        b = I[t + 1]! * 3,
        c = I[t + 2]! * 3;
      const ux = P[b]! - P[a]!,
        uy = P[b + 1]! - P[a + 1]!,
        uz = P[b + 2]! - P[a + 2]!;
      const vx = P[c]! - P[a]!,
        vy = P[c + 1]! - P[a + 1]!,
        vz = P[c + 2]! - P[a + 2]!;
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      buffer.writeFloatLE(nx, off);
      buffer.writeFloatLE(ny, off + 4);
      buffer.writeFloatLE(nz, off + 8);
      buffer.writeFloatLE(P[a]!, off + 12);
      buffer.writeFloatLE(P[a + 1]!, off + 16);
      buffer.writeFloatLE(P[a + 2]!, off + 20);
      buffer.writeFloatLE(P[b]!, off + 24);
      buffer.writeFloatLE(P[b + 1]!, off + 28);
      buffer.writeFloatLE(P[b + 2]!, off + 32);
      buffer.writeFloatLE(P[c]!, off + 36);
      buffer.writeFloatLE(P[c + 1]!, off + 40);
      buffer.writeFloatLE(P[c + 2]!, off + 44);
      buffer.writeUInt16LE(0, off + 48);
      off += 50;
    }
  }
  return buffer;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function weld({ positions: P, indices }: Mesh): Mesh {
  const at = new Map<string, number>();
  const welded: Mesh = { positions: [], indices: [] };
  const remap: number[] = [];
  const q = (v: number) => Math.round(P[v]! / LINEAR_TOL);
  for (let v = 0; v < P.length; v += 3) {
    const key = `${q(v)},${q(v + 1)},${q(v + 2)}`;
    let i = at.get(key);
    if (i === undefined) {
      i = welded.positions.length / 3;
      at.set(key, i);
      welded.positions.push(P[v]!, P[v + 1]!, P[v + 2]!);
    }
    remap.push(i);
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]!]!,
      b = remap[indices[t + 1]!]!,
      c = remap[indices[t + 2]!]!;
    if (a !== b && b !== c && c !== a) welded.indices.push(a, b, c);
  }
  return welded;
}

/** 3MF: one <object> per body, names preserved, units = millimeter. */
export function write3mf(
  bodies: { body: NamedBody; name: string; color?: string | undefined }[],
  quality = EXPORT_QUALITY,
): Buffer {
  const colors = [
    ...new Set(bodies.flatMap(({ color }) => color?.toUpperCase() ?? [])),
  ];
  const materials = bodies.length + 1;
  const bases = colors.map((c) => `<base name="${c}" displaycolor="${c}"/>`);
  const objectsXml = colors.length
    ? [`<basematerials id="${materials}">${bases.join("")}</basematerials>`]
    : [];
  const itemsXml: string[] = [];
  bodies.forEach(({ body, name, color }, i) => {
    const mesh = weld(exportMesh(body, quality));
    const id = i + 1;
    const verts: string[] = [];
    for (let v = 0; v < mesh.positions.length; v += 3) {
      verts.push(
        `<vertex x="${mesh.positions[v]!.toFixed(6)}" y="${mesh.positions[v + 1]!.toFixed(6)}" z="${mesh.positions[v + 2]!.toFixed(6)}"/>`,
      );
    }
    const tris: string[] = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      tris.push(
        `<triangle v1="${mesh.indices[t]}" v2="${mesh.indices[t + 1]}" v3="${mesh.indices[t + 2]}"/>`,
      );
    }
    const pindex = colors.indexOf(color?.toUpperCase() ?? "");
    const paint = color ? ` pid="${materials}" pindex="${pindex}"` : "";
    objectsXml.push(
      `<object id="${id}" name="${xmlEscape(name)}"${paint} type="model"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`,
    );
    itemsXml.push(`<item objectid="${id}"/>`);
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">Rockett CAD</metadata>` +
    `<resources>${objectsXml.join("")}</resources>` +
    `<build>${itemsXml.join("")}</build>` +
    `</model>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  const zipped = zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "3D/3dmodel.model": strToU8(model),
    },
    { mtime: new Date(1980, 0, 1) },
  );
  return Buffer.from(zipped);
}

export interface ExportContext extends Drawing {
  doc: CadDocument;
  bodies: NamedBody[];
  colorOf(bodyId: string): string | undefined;
  options: { quality: number; layer?: string };
}

export interface Exporter extends ExportFormat {
  write(ctx: ExportContext): Buffer;
}

export const exporters = createRegistry<Exporter>(
  "exporter",
  (exporter) => exporter.format,
);

export const registerExporter = exporters.register;

const labelled = ({ doc, bodies, colorOf }: ExportContext) =>
  bodies.map((body) => ({
    body,
    shape: body.shape,
    name: bodyName(doc, body.bodyId),
    color: colorOf(body.bodyId),
  }));

export function exporterFor(format: string): Exporter {
  const exporter = exporters.get(format);
  if (exporter) return exporter;
  const supported = exporters.list().map((e) => e.format);
  throw new ValidationError(
    `export format ${format} is not one of ${supported.join(", ")}`,
    "/format",
  );
}

registerExporter({
  format: "stl",
  label: "STL (binary)",
  ext: "stl",
  mime: "model/stl",
  source: "bodies",
  write: ({ bodies, options }) => writeStl(bodies, options.quality),
});

registerExporter({
  format: "3mf",
  label: "3MF (multi-body, named)",
  ext: "3mf",
  mime: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  source: "bodies",
  write: (ctx) => write3mf(labelled(ctx), ctx.options.quality),
});

registerExporter({
  format: "step",
  label: "STEP AP214 (named solids)",
  ext: "step",
  mime: "model/step",
  source: "bodies",
  write: ({ doc, bodies }) =>
    writeXdeStep(
      bodies.map((body) => ({
        shape: body.shape,
        name: bodyName(doc, body.bodyId),
      })),
    ),
});

registerExporter({
  format: "glb",
  label: "glTF binary (named, coloured)",
  ext: "glb",
  mime: "model/gltf-binary",
  source: "bodies",
  write: (ctx) => writeXdeGlb(labelled(ctx), tolerance(ctx.options.quality)),
});

registerExporter({
  format: "dxf",
  label: "DXF R12 (sketch or face)",
  ext: "dxf",
  mime: "image/vnd.dxf",
  source: ["sketch", "face"],
  write: ({ sketch, polylines, options }) =>
    writeDxf(sketch, polylines, options.layer),
});
