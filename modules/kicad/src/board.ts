import { child, children, num, str, type SexprList } from "./sexpr.js";
import {
  boardLoops,
  BOARD_LIMITS,
  EPS,
  gap,
  fail,
  validateSegment,
  type BoardSegment,
} from "./boardGeometry.js";
import { readGraphics } from "./boardGraphics.js";
import { readFootprints } from "./boardFootprints.js";
export { BOARD_LIMITS } from "./boardGeometry.js";
export type { BoardPoint, BoardSegment, BoardLoop } from "./boardGeometry.js";
const MIN_VERSION = 20241229;
const TESTED_VERSION = 20260206;

type Sublayer = {
  thickness?: number;
  locked?: boolean;
  material?: string;
  color?: string;
  epsilonR?: number;
  lossTangent?: number;
};
export type BoardStackup = {
  layers: { name: string; type: string; sublayers: Sublayer[] }[];
  copperFinish?: string;
  dielectricConstraints?: boolean;
  edgeConnector?: string;
  castellatedPads?: boolean;
  edgePlating?: boolean;
};

function stackup(
  tree: SexprList | undefined,
  spend: () => void,
): BoardStackup | undefined {
  if (!tree) return undefined;
  const result: BoardStackup = { layers: [] };
  for (const layer of children(tree, "layer")) {
    spend();
    const name = str(layer);
    const type = str(child(layer, "type"));
    if (!name || !type) fail("Invalid stackup layer name or type");
    const sublayers: Sublayer[] = [{}];
    for (const field of layer.slice(2)) {
      spend();
      if (field === "addsublayer") {
        sublayers.push({});
        continue;
      }
      if (!Array.isArray(field)) continue;
      const target = sublayers.at(-1)!;
      if (field[0] === "material" || field[0] === "color") {
        const value = str(field);
        if (value === undefined) fail(`Invalid stackup ${field[0]}`);
        target[field[0]] = value;
      }
      const key = {
        thickness: "thickness",
        epsilon_r: "epsilonR",
        loss_tangent: "lossTangent",
      }[String(field[0])] as
        "thickness" | "epsilonR" | "lossTangent" | undefined;
      if (!key) continue;
      const value = num(field);
      if (
        value === undefined ||
        value < 0 ||
        (key === "epsilonR" && value === 0)
      )
        fail(`Invalid stackup ${field[0]}`);
      target[key] = value;
      if (key === "thickness" && field.includes("locked")) target.locked = true;
    }
    result.layers.push({ name, type, sublayers });
  }
  for (const [field, key] of [
    ["copper_finish", "copperFinish"],
    ["edge_connector", "edgeConnector"],
  ] as const) {
    const value = str(child(tree, field));
    if (value !== undefined) result[key] = value;
  }
  for (const [field, key] of [
    ["dielectric_constraints", "dielectricConstraints"],
    ["castellated_pads", "castellatedPads"],
    ["edge_plating", "edgePlating"],
  ] as const) {
    const value = str(child(tree, field));
    if (value !== undefined) {
      if (value !== "yes" && value !== "no") fail(`Invalid stackup ${field}`);
      result[key] = value === "yes";
    }
  }
  return result;
}

function readSegments(tree: SexprList, spend: () => void) {
  const segments: BoardSegment[] = [];
  const add = (segment: BoardSegment) => {
    if (segments.length >= BOARD_LIMITS.segments)
      fail("Board segment limit exceeded");
    validateSegment(segment);
    if (segment.kind === "line" && gap(segment.from, segment.to) <= EPS)
      fail("degenerate line in Edge.Cuts");
    segments.push(segment);
  };
  readGraphics(tree, add, spend);
  for (const footprint of children(tree, "footprint")) {
    const edges = footprint.filter((entry) => {
      spend();
      return (
        Array.isArray(entry) &&
        String(entry[0]).startsWith("fp_") &&
        str(child(entry, "layer")) === "Edge.Cuts"
      );
    });
    if (edges.length) {
      const placement = child(footprint, "at");
      if (!placement) fail("Invalid Edge.Cuts footprint placement");
      readGraphics(edges, add, spend, placement);
    }
  }
  if (!segments.length) fail("Board has no Edge.Cuts outline");
  return segments;
}

export function readBoard(tree: SexprList) {
  if (tree[0] !== "kicad_pcb") fail("Expected kicad_pcb board");
  const formatVersion = num(child(tree, "version"));
  if (formatVersion === undefined || !Number.isSafeInteger(formatVersion))
    fail("Invalid board format version");
  if (formatVersion < MIN_VERSION) fail("Save this board in KiCad 9 or later");
  const thickness = num(child(child(tree, "general"), "thickness"));
  if (thickness === undefined || thickness <= 0)
    fail("Invalid board thickness");
  let work = 0;
  const spend = () => {
    if (++work > BOARD_LIMITS.work) fail("Board geometry work limit exceeded");
  };
  return {
    formatVersion,
    thickness,
    ...boardLoops(readSegments(tree, spend), spend),
    footprints: readFootprints(tree, spend),
    stackup: stackup(child(child(tree, "setup"), "stackup"), spend),
    warnings: formatVersion > TESTED_VERSION ? ["untested version"] : [],
  };
}

const quoted = (atom: unknown) =>
  typeof atom === "string" && atom.startsWith('"');

function padNet(pad: SexprList) {
  const field = child(pad, "net");
  if (!field) return undefined;
  const coded = field.length === 3 && Number.isSafeInteger(num(field));
  if (!quoted(field.at(-1)) || (!coded && field.length !== 2))
    fail("Invalid pad net");
  return str(field, field.length - 1) || undefined;
}

export type BoardNet = {
  name: string;
  members: { footprintUuid: string; reference: string; pad: string }[];
};

export function readBoardNets(tree: SexprList): BoardNet[] {
  if (tree[0] !== "kicad_pcb") fail("Expected kicad_pcb board");
  const named = new Map<string, BoardNet["members"]>();
  for (const footprint of children(tree, "footprint")) {
    const reference = children(footprint, "property").find(
      (entry) => str(entry) === "Reference",
    );
    for (const pad of children(footprint, "pad")) {
      const name = padNet(pad);
      if (name === undefined) continue;
      const footprintUuid = str(child(footprint, "uuid"));
      if (!footprintUuid) fail("Footprint with pad nets has no uuid");
      const members = named.get(name) ?? [];
      named.set(name, members);
      members.push({
        footprintUuid,
        reference: str(reference, 2) ?? "",
        pad: str(pad) ?? "",
      });
    }
  }
  return Array.from(named, ([name, members]) => ({ name, members }));
}
