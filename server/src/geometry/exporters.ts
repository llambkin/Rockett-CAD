/**
 * Mesh exporters: binary STL and 3MF.
 *
 * Both operate on fresh tessellations of the B-Rep bodies at export quality
 * (independent of the coarser viewport tessellation).
 *
 * 3MF is written directly (OPC zip + 3D/3dmodel.model XML); each body is a
 * separate <object> so multi-body models survive into slicers.
 */

import { zipSync, strToU8 } from "fflate";
import { getKernel, faces as facesOf, shapeHash, type Shape } from "./kernel.js";
import type { NamedBody } from "./naming.js";

interface Mesh {
  positions: number[];
  indices: number[];
}

/** Tessellate a body at export quality. */
export function exportMesh(body: NamedBody, quality = 0.05): Mesh {
  const k = getKernel();
  const mesh = new k.BRepMesh_IncrementalMesh_2(
    body.shape,
    quality,
    false,
    0.3,
    false
  );
  mesh.delete();

  const positions: number[] = [];
  const indices: number[] = [];
  const reversedEnum = k.TopAbs_Orientation.TopAbs_REVERSED;

  for (const face of facesOf(body.shape)) {
    const loc = new k.TopLoc_Location_1();
    const triHandle = k.BRep_Tool.Triangulation(face, loc, 0);
    if (triHandle.IsNull()) {
      loc.delete();
      triHandle.delete();
      continue;
    }
    const tri = triHandle.get();
    const trsf = loc.Transformation();
    const reversed = face.Orientation_1() === reversedEnum;
    const offset = positions.length / 3;
    const nbNodes = tri.NbNodes();
    for (let i = 1; i <= nbNodes; i++) {
      const p = tri.Node(i).Transformed(trsf);
      positions.push(p.X(), p.Y(), p.Z());
      p.delete();
    }
    const nbTris = tri.NbTriangles();
    for (let i = 1; i <= nbTris; i++) {
      const t = tri.Triangle(i);
      let a = t.Value(1),
        b = t.Value(2),
        c = t.Value(3);
      t.delete();
      if (reversed) [b, c] = [c, b];
      indices.push(offset + a - 1, offset + b - 1, offset + c - 1);
    }
    trsf.delete();
    loc.delete();
    triHandle.delete();
  }
  return { positions, indices };
}

/** Binary STL of one or more bodies merged into a single mesh. */
export function writeStl(bodies: NamedBody[], quality = 0.05): Buffer {
  const meshes = bodies.map((b) => exportMesh(b, quality));
  const triCount = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const buffer = Buffer.alloc(84 + triCount * 50);
  buffer.write("Rockett CAD binary STL (units: mm)", 0, "ascii");
  buffer.writeUInt32LE(triCount, 80);
  let off = 84;
  for (const mesh of meshes) {
    const { positions: P, indices: I } = mesh;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3,
        b = I[t + 1] * 3,
        c = I[t + 2] * 3;
      const ux = P[b] - P[a],
        uy = P[b + 1] - P[a + 1],
        uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a],
        vy = P[c + 1] - P[a + 1],
        vz = P[c + 2] - P[a + 2];
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
      buffer.writeFloatLE(P[a], off + 12);
      buffer.writeFloatLE(P[a + 1], off + 16);
      buffer.writeFloatLE(P[a + 2], off + 20);
      buffer.writeFloatLE(P[b], off + 24);
      buffer.writeFloatLE(P[b + 1], off + 28);
      buffer.writeFloatLE(P[b + 2], off + 32);
      buffer.writeFloatLE(P[c], off + 36);
      buffer.writeFloatLE(P[c + 1], off + 40);
      buffer.writeFloatLE(P[c + 2], off + 44);
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

/** 3MF: one <object> per body, names preserved, units = millimeter. */
export function write3mf(
  bodies: { body: NamedBody; name: string }[],
  quality = 0.05
): Buffer {
  const objectsXml: string[] = [];
  const itemsXml: string[] = [];
  bodies.forEach(({ body, name }, i) => {
    const mesh = exportMesh(body, quality);
    const id = i + 1;
    const verts: string[] = [];
    for (let v = 0; v < mesh.positions.length; v += 3) {
      verts.push(
        `<vertex x="${mesh.positions[v].toFixed(6)}" y="${mesh.positions[v + 1].toFixed(6)}" z="${mesh.positions[v + 2].toFixed(6)}"/>`
      );
    }
    const tris: string[] = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      tris.push(
        `<triangle v1="${mesh.indices[t]}" v2="${mesh.indices[t + 1]}" v3="${mesh.indices[t + 2]}"/>`
      );
    }
    objectsXml.push(
      `<object id="${id}" name="${xmlEscape(name)}" type="model"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`
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

  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
  return Buffer.from(zipped);
}
