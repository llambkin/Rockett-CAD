import { inflateRawSync } from "node:zlib";
import type { MeshPart } from "./importers.js";

const MAX_3MF_EXPANDED = 256 * 1024 * 1024;

const UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
const ATTR = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const tooLarge = () =>
  new Error(
    `The 3MF file expands past ${MAX_3MF_EXPANDED / 1024 / 1024} MB, the limit.`,
  );
const invalid = () => new Error("The 3MF file is not a valid zip package.");

interface Entry {
  data: Buffer;
  method: number;
  flags: number;
}

function zipEntries(zip: Buffer): Map<string, Entry> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > zip.length) throw invalid();
  const entries = new Map<string, Entry>();
  let p = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    if (p + 46 > end || zip.readUInt32LE(p) !== 0x02014b50) throw invalid();
    const nameLength = zip.readUInt16LE(p + 28),
      local = zip.readUInt32LE(p + 42);
    if (local + 30 > end || zip.readUInt32LE(local) !== 0x04034b50)
      throw invalid();
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.set(
      zip.toString("utf8", p + 46, p + 46 + nameLength).toLowerCase(),
      {
        data: zip.subarray(start, start + zip.readUInt32LE(p + 20)),
        method: zip.readUInt16LE(p + 10),
        flags: zip.readUInt16LE(p + 8),
      },
    );
    p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return entries;
}

function expand({ data, method, flags }: Entry): string {
  if (flags & 1)
    throw new Error("The 3MF file is encrypted, which is not supported.");
  if (method === 0) return data.toString("utf8");
  if (method !== 8) throw invalid();
  try {
    return inflateRawSync(data, {
      maxOutputLength: MAX_3MF_EXPANDED,
    }).toString("utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
      throw tooLarge();
    throw invalid();
  }
}

function* tags(xml: string) {
  for (const [, close, name, body, empty] of xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const [, key, double, single] of body!.matchAll(ATTR))
      attrs[key!] = double ?? single!;
    yield { close: close === "/", name: name!, attrs, empty: empty === "/" };
  }
}

function modelPath(entries: Map<string, Entry>): string {
  const rels = entries.get("_rels/.rels");
  for (const { name, attrs } of rels ? tags(expand(rels)) : [])
    if (name === "Relationship" && attrs.Type?.endsWith("/3dmodel"))
      return attrs.Target!.replace(/^\//, "").toLowerCase();
  return "3d/3dmodel.model";
}

function transformOf(value: string | undefined, scale: number): number[] {
  const m = (value ?? "1 0 0 0 1 0 0 0 1 0 0 0")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (m.length !== 12 || !m.every(Number.isFinite))
    throw new Error(`The 3MF build item transform "${value}" is not valid.`);
  return m.map((v) => v * scale);
}

export function read3mf(bytes: Buffer): MeshPart[] {
  let zip: Map<string, Entry>;
  try {
    zip = zipEntries(bytes);
  } catch (error) {
    if (error instanceof RangeError) throw invalid();
    throw error;
  }
  const model = zip.get(modelPath(zip));
  if (!model) throw new Error("The 3MF file has no 3D model part.");
  const meshes = new Map<string, { nodes: number[]; triangles: number[] }>(),
    parts: MeshPart[] = [];
  let scale = 1,
    object: { id: string; nodes: number[]; triangles: number[] } | undefined,
    meshed = false;
  for (const { close, name, attrs, empty } of tags(expand(model))) {
    if (name === "model" && !close) {
      const unit = attrs.unit ?? "millimeter";
      if (!Object.hasOwn(UNITS, unit))
        throw new Error(`The 3MF unit "${unit}" is not supported.`);
      scale = UNITS[unit]!;
    } else if (name === "object" && !close && !empty) {
      object = { id: attrs.id ?? "", nodes: [], triangles: [] };
      meshed = false;
    } else if (name === "object" && close) {
      if (object && meshed) meshes.set(object.id, object);
      object = undefined;
    } else if (name === "mesh" && object) {
      meshed = true;
    } else if (name === "vertex" && object) {
      const point = [attrs.x, attrs.y, attrs.z].map(Number);
      if (!point.every(Number.isFinite))
        throw new Error(`The 3MF object ${object.id} has an invalid vertex.`);
      object.nodes.push(...point);
    } else if (name === "triangle" && object) {
      const corners = [attrs.v1, attrs.v2, attrs.v3].map(Number);
      if (
        !corners.every(
          (v) => Number.isInteger(v) && v >= 0 && v < object!.nodes.length / 3,
        )
      )
        throw new Error(
          `The 3MF object ${object.id} has a triangle outside its vertices.`,
        );
      object.triangles.push(...corners);
    } else if (name === "item") {
      const mesh = meshes.get(attrs.objectid ?? "");
      if (!mesh)
        throw new Error(
          `The 3MF build item ${attrs.objectid} is not a mesh object; components are not supported.`,
        );
      parts.push({
        nodes: mesh.nodes,
        triangles: mesh.triangles,
        transform: transformOf(attrs.transform, scale),
      });
    }
  }
  return parts;
}
