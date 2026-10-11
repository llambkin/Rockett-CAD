import { child, children, num, str, type SexprList } from "./sexpr.js";
import { readPlacement, readGraphics } from "./boardGraphics.js";
import {
  BOARD_LIMITS,
  fail,
  segmentBounds,
  type BoardBounds,
  type BoardPoint,
} from "./boardGeometry.js";

function readPads(
  tree: SexprList,
  point: ReturnType<typeof readPlacement>["point"],
  spend: () => void,
) {
  return children(tree, "pad").flatMap((pad) => {
    spend();
    const type = str(pad, 2);
    if (type === undefined) return [];
    if (!["thru_hole", "np_thru_hole", "smd", "connect"].includes(type))
      fail("Unsupported pad type");
    const at = child(pad, "at") ?? ["at", "0", "0"];
    const angle = at[3] === undefined ? 0 : num(at, 3);
    if (angle === undefined) fail("Invalid pad angle");
    const [x, y] = point(at);
    const field = child(pad, "drill");
    const offset = child(field, "offset");
    const shapeOffset: BoardPoint = offset
      ? [
          num(offset) ?? fail("Invalid pad shape offset"),
          num(offset, 2) ?? fail("Invalid pad shape offset"),
        ]
      : [0, 0];
    let drill:
      { shape: "round" | "oval"; width: number; height: number } | undefined;
    if (field && (type === "thru_hole" || type === "np_thru_hole")) {
      const oval = field[1] === "oval",
        index = oval ? 2 : 1;
      const width = num(field, index);
      const height =
        typeof field[index + 1] === "string" ? num(field, index + 1) : width;
      if (
        width === undefined ||
        height === undefined ||
        width <= 0 ||
        height <= 0
      )
        fail("Invalid pad drill size");
      drill = { shape: oval ? "oval" : "round", width, height };
    }
    return [{ number: str(pad), type, x, y, angle, shapeOffset, drill }];
  });
}

function vector(
  model: SexprList,
  name: string,
  fallback: number,
): [number, number, number] {
  const field = child(model, name);
  if (!field) return [fallback, fallback, fallback];
  const xyz = child(field, "xyz");
  if (!xyz || xyz.length !== 4) fail(`Invalid model ${name}`);
  const coordinate = (index: number) =>
    num(xyz, index) ?? fail(`Invalid model ${name}`);
  return [coordinate(1), coordinate(2), coordinate(3)];
}

function readFootprint(tree: SexprList, spend: () => void) {
  spend();
  const placement = child(tree, "at");
  const { x, y, angle, point } = readPlacement(placement);
  const layer = str(child(tree, "layer"));
  if (layer !== undefined && layer !== "F.Cu" && layer !== "B.Cu")
    fail("Invalid footprint layer");
  const side =
    layer === undefined ? undefined : layer === "B.Cu" ? "back" : "front";
  const attributes = (child(tree, "attr")?.slice(1) ?? []).map((atom) => {
    spend();
    if (typeof atom !== "string") fail("Invalid footprint attribute");
    return str(["attr", atom])!;
  });
  let courtyard: BoardBounds | undefined,
    segments = 0;
  if (side)
    readGraphics(
      tree,
      (segment) => {
        spend();
        if (++segments > BOARD_LIMITS.segments)
          fail("Board segment limit exceeded");
        const bounds = segmentBounds(segment);
        if (!courtyard) courtyard = bounds;
        else
          for (const axis of [0, 1] as const) {
            courtyard.min[axis] = Math.min(
              courtyard.min[axis],
              bounds.min[axis],
            );
            courtyard.max[axis] = Math.max(
              courtyard.max[axis],
              bounds.max[axis],
            );
          }
      },
      spend,
      placement,
      side === "back" ? "B.CrtYd" : "F.CrtYd",
    );
  const property = (name: string) => {
    const entry = children(tree, "property").find((item) => str(item) === name);
    return str(entry, 2);
  };
  const models = children(tree, "model").map((model) => {
    spend();
    if (child(model, "at")) fail("Unsupported legacy model offset");
    const path = str(model);
    if (!path?.trim() || /\p{Cc}/u.test(path)) fail("Invalid model path");
    return {
      path,
      offset: vector(model, "offset", 0),
      scale: vector(model, "scale", 1),
      rotate: vector(model, "rotate", 0),
    };
  });
  return {
    uuid: str(child(tree, "uuid")),
    libId: str(tree),
    reference: property("Reference"),
    value: property("Value"),
    side,
    x,
    y,
    angle,
    attributes,
    pads: readPads(tree, point, spend),
    courtyard,
    models,
  };
}

export function readFootprints(tree: SexprList, spend: () => void) {
  return children(tree, "footprint").map((footprint) =>
    readFootprint(footprint, spend),
  );
}
