import { child, num, str, type SexprList } from "./sexpr.js";
import {
  arc,
  circle,
  EPS,
  gap,
  fail,
  finite,
  type BoardPoint,
  type BoardSegment,
} from "./boardGeometry.js";

export function readPlacement(placement?: SexprList) {
  const x = placement ? num(placement) : 0,
    y = placement ? num(placement, 2) : 0;
  const degrees = placement?.[3] === undefined ? 0 : num(placement, 3);
  if (x === undefined || y === undefined || degrees === undefined)
    fail("Invalid board coordinate or footprint placement");
  const theta = (degrees * Math.PI) / 180;
  if (!Number.isFinite(theta))
    fail("Invalid board coordinate or footprint placement");
  const cosine = Math.cos(theta),
    sine = Math.sin(theta);
  const point = (field: SexprList | undefined): BoardPoint => {
    const px = num(field),
      py = num(field, 2);
    if (px === undefined || py === undefined)
      return fail("Invalid board coordinate or footprint placement");
    const mapped: BoardPoint = [
      finite(x + px * cosine + py * sine),
      finite(-y + px * sine - py * cosine),
    ];
    return [mapped[0] === 0 ? 0 : mapped[0], mapped[1] === 0 ? 0 : mapped[1]];
  };
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : -y, angle: degrees, point };
}

export function readGraphics(
  items: SexprList,
  add: (segment: BoardSegment) => void,
  spend: () => void,
  placement?: SexprList,
  layer = "Edge.Cuts",
) {
  const { point } = readPlacement(placement);
  const makeArc = (item: SexprList) =>
    arc(
      point(child(item, "start")),
      point(child(item, "mid")),
      point(child(item, "end")),
    );
  for (const item of items) {
    spend();
    if (
      !Array.isArray(item) ||
      !/^(gr|fp)_/.test(String(item[0])) ||
      str(child(item, "layer")) !== layer
    )
      continue;
    const kind = String(item[0]).slice(3);
    if (kind === "arc") {
      add(makeArc(item));
      continue;
    }
    if (kind === "circle") {
      add(circle(point(child(item, "center")), point(child(item, "end"))));
      continue;
    }
    if (kind === "line") {
      add({
        kind: "line",
        from: point(child(item, "start")),
        to: point(child(item, "end")),
      });
      continue;
    }
    if (kind === "rect") {
      const start = child(item, "start"),
        end = child(item, "end");
      const points = [
        point(start),
        point(["xy", end?.[1] ?? "", start?.[2] ?? ""]),
        point(end),
        point(["xy", start?.[1] ?? "", end?.[2] ?? ""]),
      ];
      points.forEach((from, i) =>
        add({ kind: "line", from, to: points[(i + 1) % 4]! }),
      );
      continue;
    }
    if (kind !== "poly") fail(`unsupported ${layer} item ${item[0]}`);
    const entries = child(item, "pts")?.slice(1) ?? [];
    let first: BoardPoint | undefined, previous: BoardPoint | undefined;
    let curves = 0;
    for (const entry of entries) {
      spend();
      if (!Array.isArray(entry) || (entry[0] !== "xy" && entry[0] !== "arc"))
        fail(`Invalid ${layer} polygon point`);
      const curved = entry[0] === "arc" ? makeArc(entry) : undefined;
      const next = curved?.from ?? point(entry);
      first ??= next;
      if (previous && gap(previous, next) > EPS)
        add({ kind: "line", from: previous, to: next });
      if (curved) {
        add(curved);
        curves++;
      }
      previous = curved?.to ?? next;
    }
    if (entries.length < (curves ? 2 : 3) || !first || !previous)
      fail(`Invalid ${layer} polygon`);
    if (gap(previous, first) > EPS)
      add({ kind: "line", from: previous, to: first });
  }
}
