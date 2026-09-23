import {
  sketchBuilder,
  type SketchBuilder,
  type SketchImport,
  type XY,
} from "./sketchBuilder.js";

type Matrix = [number, number, number, number, number, number];
type Attributes = Record<string, string>;
type Pen = ReturnType<typeof pen>;

const TOL = 0.05;
const MAX_STEPS = 4096;
const MAX_DEPTH = 16;
const PX = 25.4 / 96;
const MM_PER_UNIT: Record<string, number> = {
  px: PX,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  mm: 1,
  cm: 10,
  in: 25.4,
};
const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const TAG =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SHAPES = new Set([
  "path",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
]);
const UNSUPPORTED = new Set(["ellipse", "text", "image", "use"]);
const HIDDEN = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "pattern",
  "marker",
]);
const ARGS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

export function importSvg(text: string): SketchImport {
  const sketch = sketchBuilder();
  const open: { name: string; m: Matrix | null }[] = [];
  let found = false;
  let skipped = 0;
  for (const [, closing, tag, attrText = "", selfClosing] of text.matchAll(
    TAG,
  )) {
    if (closing) {
      const at = open.map((e) => e.name).lastIndexOf(local(closing));
      if (at >= 0) open.length = at;
      continue;
    }
    if (!tag) continue;
    const name = local(tag);
    const a = attributes(attrText);
    const parent = open.at(-1)?.m ?? null;
    let m: Matrix | null = null;
    if (name === "svg" && !found) {
      found = true;
      m = documentMatrix(a);
    } else if (parent && !HIDDEN.has(name))
      m = multiply(parent, transform(a.transform));
    if (m && SHAPES.has(name) && !drawShape(pen(sketch, m), name, a)) skipped++;
    if (m && UNSUPPORTED.has(name)) skipped++;
    if (!selfClosing) open.push({ name, m });
  }
  if (!found) throw new Error("Not an SVG file: no svg element was found.");
  return { entities: sketch.entities, skipped };
}

const local = (name: string) =>
  name.startsWith("svg:") ? name.slice(4) : name;

function attributes(text: string): Attributes {
  return Object.fromEntries(
    [...text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
      ([, key, double, single]) => [key, double ?? single ?? ""],
    ),
  );
}

const numbers = (text = "") =>
  [...text.matchAll(new RegExp(NUMBER, "g"))].map((m) => Number(m[0]));

function lengthMm(value = ""): number | undefined {
  const m = new RegExp(`^\\s*(${NUMBER})\\s*(px|pt|pc|mm|cm|in)?\\s*$`).exec(
    value,
  );
  const mm = m ? Number(m[1]) * MM_PER_UNIT[m[2] ?? "px"]! : NaN;
  return mm > 0 ? mm : undefined;
}

function documentMatrix(a: Attributes): Matrix {
  const box = numbers(a.viewBox);
  const view = box.length === 4 && box[2]! > 0 && box[3]! > 0 ? box : null;
  const width = lengthMm(a.width);
  const s = view && width ? width / view[2]! : PX;
  const [x, y, h] = view
    ? [view[0]!, view[1]!, view[3]!]
    : [0, 0, (lengthMm(a.height) ?? 0) / PX];
  return [s, 0, 0, -s, -s * x, s * (y + h)];
}

const multiply = (
  [a, b, c, d, e, f]: Matrix,
  [g, h, i, j, k, l]: Matrix,
): Matrix => [
  a * g + c * h,
  b * g + d * h,
  a * i + c * j,
  b * i + d * j,
  a * k + c * l + e,
  b * k + d * l + f,
];

function transform(text = ""): Matrix {
  let m = IDENTITY;
  for (const [, kind = "", args] of text.matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g,
  ))
    m = multiply(m, transformStep(kind, numbers(args)));
  return m;
}

function transformStep(kind: string, n: number[]): Matrix {
  const [p = 0, q, r = 0] = n;
  const rad = (p * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  switch (kind) {
    case "matrix":
      return n.length === 6 ? (n as Matrix) : IDENTITY;
    case "translate":
      return [1, 0, 0, 1, p, q ?? 0];
    case "scale":
      return [p, 0, 0, q ?? p, 0, 0];
    case "rotate": {
      const cx = q ?? 0;
      return [
        cos,
        sin,
        -sin,
        cos,
        cx - cos * cx + sin * r,
        r - sin * cx - cos * r,
      ];
    }
    case "skewX":
      return [1, 0, Math.tan(rad), 1, 0, 0];
    default:
      return [1, Math.tan(rad), 0, 1, 0, 0];
  }
}

function drawShape(p: Pen, name: string, a: Attributes): boolean {
  const n = (key: string) => {
    const v = Number.parseFloat(a[key] ?? "");
    return Number.isFinite(v) ? v : 0;
  };
  switch (name) {
    case "path":
      return drawPath(p, a.d ?? "");
    case "line":
      return p.line([n("x1"), n("y1")], [n("x2"), n("y2")]);
    case "polyline":
      return drawPath(p, `M ${a.points ?? ""}`);
    case "polygon":
      return drawPath(p, `M ${a.points ?? ""} Z`);
    case "circle":
      return p.circle([n("cx"), n("cy")], n("r"));
    default:
      return drawPath(
        p,
        rectPath(n("x"), n("y"), n("width"), n("height"), a.rx, a.ry),
      );
  }
}

function radius(v = "") {
  const r = Number.parseFloat(v);
  return r >= 0 ? r : undefined;
}

function rectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rxText?: string,
  ryText?: string,
): string {
  if (!(w > 0 && h > 0)) return "";
  const rx = Math.min(radius(rxText) ?? radius(ryText) ?? 0, w / 2);
  const ry = Math.min(radius(ryText) ?? radius(rxText) ?? 0, h / 2);
  if (rx === 0 || ry === 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  const arc = `A ${rx} ${ry} 0 0 1`;
  return `M ${x + rx} ${y} H ${x + w - rx} ${arc} ${x + w} ${y + ry} V ${y + h - ry} ${arc} ${x + w - rx} ${y + h} H ${x + rx} ${arc} ${x} ${y + h - ry} V ${y + ry} ${arc} ${x + rx} ${y} Z`;
}

function* commands(d: string): Generator<[string, number[]]> {
  const number = new RegExp(NUMBER, "y");
  let i = 0;
  let cmd = "";
  const gap = () => {
    while (/[\s,]/.test(d[i] ?? "")) i++;
  };
  const next = (flag: boolean) => {
    gap();
    if (flag) return d[i] === "0" || d[i] === "1" ? Number(d[i++]) : null;
    number.lastIndex = i;
    const m = number.exec(d);
    if (!m) return null;
    i = number.lastIndex;
    return Number(m[0]);
  };
  for (;;) {
    gap();
    if (i >= d.length) return;
    const letter = d[i]!;
    if (Object.hasOwn(ARGS, letter.toUpperCase())) {
      if (!cmd && letter.toUpperCase() !== "M") return;
      cmd = letter;
      i++;
    } else if (!cmd || cmd.toUpperCase() === "Z") return;
    const upper = cmd.toUpperCase();
    const args: number[] = [];
    for (let k = 0; k < ARGS[upper]!; k++) {
      const v = next(upper === "A" && (k === 3 || k === 4));
      if (v === null) return;
      args.push(v);
    }
    yield [cmd, args];
    if (upper === "M") cmd = cmd === "M" ? "L" : "l";
  }
}

function drawPath(p: Pen, d: string): boolean {
  let cur: XY = [0, 0];
  let start = cur;
  let last: { kind: string; ctrl: XY } | null = null;
  let added = false;
  const mirror = (kind: string): XY =>
    last?.kind === kind
      ? [2 * cur[0] - last.ctrl[0], 2 * cur[1] - last.ctrl[1]]
      : cur;
  for (const [cmd, n] of commands(d)) {
    const upper = cmd.toUpperCase();
    const [ox, oy] = cmd === upper ? [0, 0] : cur;
    const pt = (k: number): XY => [n[k]! + ox, n[k + 1]! + oy];
    let next = cur;
    let ctrl: XY | null = null;
    let drawn = false;
    switch (upper) {
      case "M":
        next = start = pt(0);
        break;
      case "L":
        next = pt(0);
        drawn = p.line(cur, next);
        break;
      case "H":
        next = [n[0]! + ox, cur[1]];
        drawn = p.line(cur, next);
        break;
      case "V":
        next = [cur[0], n[0]! + oy];
        drawn = p.line(cur, next);
        break;
      case "Z":
        next = start;
        drawn = p.line(cur, next);
        break;
      case "C":
      case "S":
        ctrl = pt(upper === "C" ? 2 : 0);
        next = pt(upper === "C" ? 4 : 2);
        drawn = p.cubic(cur, upper === "C" ? pt(0) : mirror("C"), ctrl, next);
        break;
      case "Q":
      case "T":
        ctrl = upper === "Q" ? pt(0) : mirror("Q");
        next = pt(upper === "Q" ? 2 : 0);
        drawn = p.quad(cur, ctrl, next);
        break;
      default:
        next = pt(5);
        drawn = p.arc(cur, next, n);
    }
    last = ctrl ? { kind: "CS".includes(upper) ? "C" : "Q", ctrl } : null;
    added = drawn || added;
    cur = next;
  }
  return added;
}

function toSegment(p: XY, a: XY, b: XY): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t =
    len === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len),
        );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const toward = (a: XY, q: XY): XY => [
  a[0] + (2 * (q[0] - a[0])) / 3,
  a[1] + (2 * (q[1] - a[1])) / 3,
];

const mid = (u: XY, v: XY): XY => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];

function flatten([a, b, c, d]: XY[], depth: number, out: XY[]) {
  if (
    depth >= MAX_DEPTH ||
    (toSegment(b!, a!, d!) <= TOL && toSegment(c!, a!, d!) <= TOL)
  ) {
    out.push(d!);
    return;
  }
  const [ab, bc, cd] = [mid(a!, b!), mid(b!, c!), mid(c!, d!)];
  const [abc, bcd] = [mid(ab, bc), mid(bc, cd)];
  const m = mid(abc, bcd);
  flatten([a!, ab, abc, m], depth + 1, out);
  flatten([m, bcd, cd, d!], depth + 1, out);
}

function arcCenter(p0: XY, p1: XY, n: number[]) {
  const phi = (n[2]! * Math.PI) / 180;
  const [large, sweep] = [n[3] === 1, n[4] === 1];
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [hx, hy] = [(p0[0] - p1[0]) / 2, (p0[1] - p1[1]) / 2];
  const x = cos * hx + sin * hy;
  const y = -sin * hx + cos * hy;
  const [ax, ay] = [Math.abs(n[0]!), Math.abs(n[1]!)];
  const grow = Math.sqrt(
    Math.max(1, (x * x) / (ax * ax) + (y * y) / (ay * ay)),
  );
  const [rx, ry] = [ax * grow, ay * grow];
  const den = rx * rx * y * y + ry * ry * x * x;
  const k =
    (large === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den));
  const [cx, cy] = [(k * rx * y) / ry, (-k * ry * x) / rx];
  const t0 = Math.atan2((y - cy) / ry, (x - cx) / rx);
  let dt = Math.atan2((-y - cy) / ry, (-x - cx) / rx) - t0;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  const c: XY = [
    cos * cx - sin * cy + (p0[0] + p1[0]) / 2,
    sin * cx + cos * cy + (p0[1] + p1[1]) / 2,
  ];
  return { c, rx, ry, cos, sin, t0, dt };
}

function pen(sketch: SketchBuilder, m: Matrix) {
  const at = ([x, y]: XY): XY => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const lin = ([x, y]: XY): XY => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
  const det = m[0] * m[3] - m[1] * m[2];
  const size = Math.hypot(m[0], m[1], m[2], m[3]) * 1e-9;
  const similar =
    Math.hypot(m[0] - m[3], m[1] + m[2]) <= size ||
    Math.hypot(m[0] + m[3], m[1] - m[2]) <= size;
  const chain = (points: XY[]) =>
    points
      .slice(1)
      .reduce((added, p, i) => sketch.line(points[i]!, p) || added, false);
  const ellipse = (c: XY, u: XY, v: XY, t0: number, dt: number): XY[] => {
    const sum = u[0] ** 2 + u[1] ** 2 + v[0] ** 2 + v[1] ** 2;
    const cross = u[0] * v[1] - u[1] * v[0];
    const r = Math.sqrt(
      (sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * cross ** 2))) / 2,
    );
    const step = 2 * Math.acos(Math.max(-1, 1 - TOL / r));
    const count = Math.min(
      MAX_STEPS,
      Math.max(1, Math.ceil(Math.abs(dt) / step)),
    );
    return Array.from({ length: count + 1 }, (_, k): XY => {
      const t = t0 + (dt * k) / count;
      const [ct, st] = [Math.cos(t), Math.sin(t)];
      return [c[0] + u[0] * ct + v[0] * st, c[1] + u[1] * ct + v[1] * st];
    });
  };
  const cubic = (a: XY, b: XY, c: XY, d: XY) => {
    const out = [at(a)];
    flatten([at(a), at(b), at(c), at(d)], 0, out);
    return chain(out);
  };
  return {
    line: (a: XY, b: XY) => sketch.line(at(a), at(b)),
    cubic,
    quad: (a: XY, q: XY, b: XY) => cubic(a, toward(a, q), toward(b, q), b),
    circle(c: XY, r: number) {
      if (!(r > 0)) return false;
      if (similar) return sketch.circle(at(c), r * Math.sqrt(Math.abs(det)));
      return chain(ellipse(at(c), lin([r, 0]), lin([0, r]), 0, 2 * Math.PI));
    },
    arc(p0: XY, p1: XY, n: number[]) {
      if (p0[0] === p1[0] && p0[1] === p1[1]) return false;
      if (n[0] === 0 || n[1] === 0) return sketch.line(at(p0), at(p1));
      const { c, rx, ry, cos, sin, t0, dt } = arcCenter(p0, p1, n);
      if (similar && Math.abs(rx - ry) <= 1e-9 * Math.max(rx, ry)) {
        const [s, e] = dt > 0 === det > 0 ? [p0, p1] : [p1, p0];
        return sketch.arc(at(c), at(s), at(e));
      }
      const u = lin([rx * cos, rx * sin]);
      const v = lin([-ry * sin, ry * cos]);
      const points = ellipse(at(c), u, v, t0, dt);
      points[0] = at(p0);
      points[points.length - 1] = at(p1);
      return chain(points);
    },
  };
}
