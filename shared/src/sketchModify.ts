import {
  newId,
  type SketchConstraint,
  type SketchEntity,
  type SketchPoint,
} from "./model.js";

type XY = { x: number; y: number };
type Curve = Exclude<SketchEntity, SketchPoint>;
const TAU = Math.PI * 2,
  EPS = 1e-7;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const mod = (a: number) => ((a % TAU) + TAU) % TAU;
const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const constructionOf = (e: Curve) =>
  e.construction === undefined ? {} : { construction: e.construction };

function geometry(e: Curve, entities: SketchEntity[]) {
  const p = (id: string) => {
    const point = entities.find((x) => x.id === id);
    if (!point || point.kind !== "point")
      throw new Error("Sketch endpoint is missing.");
    return point;
  };
  const a =
    e.kind === "line" ? p(e.p1) : e.kind === "arc" ? p(e.start) : p(e.center);
  const b = e.kind === "line" ? p(e.p2) : e.kind === "arc" ? p(e.end) : a;
  const c = e.kind === "line" ? a : p(e.center);
  const r = e.kind === "circle" ? e.radius : distance(c, a);
  const start = e.kind === "arc" ? Math.atan2(a.y - c.y, a.x - c.x) : 0;
  const span =
    e.kind === "arc" ? mod(Math.atan2(b.y - c.y, b.x - c.x) - start) : TAU;
  const at = (t: number): XY =>
    e.kind === "line"
      ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      : {
          x: c.x + r * Math.cos(start + t * span),
          y: c.y + r * Math.sin(start + t * span),
        };
  const parameter = (q: XY) =>
    e.kind === "line"
      ? dot(sub(q, a), sub(b, a)) / dot(sub(b, a), sub(b, a))
      : mod(Math.atan2(q.y - c.y, q.x - c.x) - start) / span;
  const contains = (q: XY) => {
    if (e.kind === "circle") return true;
    if (distance(q, a) < EPS || distance(q, b) < EPS) return true;
    const t = parameter(q);
    return t >= -EPS && t <= 1 + EPS;
  };
  return { e, a, b, c, r, span, at, parameter, contains };
}
type Geometry = ReturnType<typeof geometry>;

/** Analytic intersections; caller decides which curves are bounded. */
function intersections(a: Geometry, b: Geometry): XY[] {
  if (a.e.kind === "line" && b.e.kind === "line") {
    const d = sub(a.b, a.a),
      e = sub(b.b, b.a),
      den = cross(d, e);
    if (Math.abs(den) < EPS) return [];
    const t = cross(sub(b.a, a.a), e) / den;
    return [a.at(t)];
  }
  if (b.e.kind === "line") return intersections(b, a);
  if (a.e.kind === "line") {
    const d = sub(a.b, a.a),
      q = sub(a.a, b.c);
    const aa = dot(d, d),
      bb = 2 * dot(q, d),
      cc = dot(q, q) - b.r * b.r;
    const discriminant = bb * bb - 4 * aa * cc;
    if (aa < EPS * EPS || discriminant < -EPS) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return [a.at((-bb - root) / (2 * aa)), a.at((-bb + root) / (2 * aa))];
  }
  const d = distance(a.c, b.c);
  if (d < EPS || d > a.r + b.r + EPS || d < Math.abs(a.r - b.r) - EPS)
    return [];
  const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const ux = (b.c.x - a.c.x) / d,
    uy = (b.c.y - a.c.y) / d;
  return [1, -1].map((sign) => ({
    x: a.c.x + x * ux - sign * h * uy,
    y: a.c.y + x * uy + sign * h * ux,
  }));
}

export interface SketchModification {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  removedConstraints: number;
  joinedGaps?: { count: number; maxDistance: number };
  offsetChain?: { closed: boolean; endGap: number; ends: [XY, XY] };
}
export const constraintEntityRefs = (c: SketchConstraint): string[] =>
  ["a", "b", "point", "line", "circle", "entity"]
    .map((k) => (c as unknown as Record<string, unknown>)[k])
    .filter((x): x is string => typeof x === "string");

export function extendSketch(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  entityId: string,
  click: XY,
): SketchModification {
  const entity = entities.find((e) => e.id === entityId);
  if (!entity || entity.kind === "point")
    throw new Error("Choose a sketch curve.");
  if (entity.external)
    throw new Error(
      "Projected references cannot be extended. Draw a curve constrained to the reference instead.",
    );
  if (entity.kind === "circle")
    throw new Error("A full circle has no endpoint to extend.");
  const g = geometry(entity, entities);
  const hits: XY[] = [];
  for (const other of entities) {
    if (other.id === entityId || other.kind === "point") continue;
    const h = geometry(other, entities);
    for (const q of intersections(g, h))
      if (h.contains(q) && !hits.some((p) => distance(p, q) < EPS))
        hits.push(q);
  }
  const start = distance(click, g.a) < distance(click, g.b);
  const candidates = hits
    .map((q) => g.parameter(q))
    .filter((t) =>
      entity.kind === "line"
        ? start
          ? t < -EPS
          : t > 1 + EPS
        : t > 1 + EPS && t < TAU / g.span - EPS,
    );
  if (!candidates.length)
    throw new Error("No boundary intersects beyond this endpoint.");
  const [a, b]: [number, number] =
    entity.kind === "line"
      ? start
        ? [Math.max(...candidates), 1]
        : [0, Math.min(...candidates)]
      : start
        ? [Math.max(...candidates) - TAU / g.span, 1]
        : [0, Math.min(...candidates)];
  const added: SketchEntity[] = [];
  const point = (q: XY) => {
    const id = newId("p");
    added.push({ id, kind: "point", x: q.x, y: q.y });
    return id;
  };
  const [first, last] =
    entity.kind === "line"
      ? [entity.p1, entity.p2]
      : [entity.start, entity.end];
  const pa = Math.abs(a) < EPS ? first : point(g.at(a));
  const pb = Math.abs(b - 1) < EPS ? last : point(g.at(b));
  added.push(
    entity.kind === "line"
      ? { ...entity, p1: pa, p2: pb }
      : { ...entity, start: pa, end: pb },
  );
  const moved = start ? first : last;
  const next = [...entities.filter((e) => e.id !== entityId), ...added];
  const orphaned = next.some(
    (e) =>
      (e.kind === "line" && (e.p1 === moved || e.p2 === moved)) ||
      (e.kind === "arc" && (e.start === moved || e.end === moved)),
  )
    ? null
    : moved;
  const kept = constraints.filter(
    (c) =>
      !constraintEntityRefs(c).some((id) => id === entityId || id === orphaned),
  );
  return {
    entities: next.filter((e) => e.id !== orphaned),
    constraints: kept,
    removedConstraints: constraints.length - kept.length,
  };
}

/** Offset an analytic curve; positive distance is left of a line or outside a circle/arc. */
export function offsetSketchSelection(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  entityIds: string[],
  amount: number,
  autoChain = true,
  joinTolerance = 0.01,
): SketchModification {
  const ids = [...new Set(entityIds)];
  if (!ids.length)
    throw new Error("Select one or more sketch curves to offset.");
  if (ids.length === 1)
    return offsetSketch(entities, constraints, ids[0]!, amount, autoChain);
  if (!Number.isFinite(amount) || Math.abs(amount) < EPS)
    throw new Error("Enter a non-zero offset distance in mm.");
  const selected = ids.map((id) => entities.find((e) => e.id === id));
  if (selected.some((e) => !e || (e.kind !== "line" && e.kind !== "arc")))
    throw new Error(
      "Select connected lines and arcs. Offset a complete circle separately.",
    );
  const curves = selected as Curve[];
  if (!Number.isFinite(joinTolerance) || joinTolerance < 0 || joinTolerance > 1)
    throw new Error("Join tolerance must be between 0 and 1 mm.");
  const chosen = new Set(ids);
  const source = entities
    .filter((e) => e.kind === "point" || chosen.has(e.id))
    .map((e) => ({ ...e }));
  const gaps = joinOffsetEndpoints(curves, source, joinTolerance);
  const endpoints: { point: XY; count: number }[] = [];
  for (const curve of curves) {
    const g = geometry(curve, source);
    for (const point of [g.a, g.b]) {
      const node = endpoints.find((n) => distance(n.point, point) < EPS);
      if (node) node.count++;
      else endpoints.push({ point, count: 1 });
    }
  }
  if (endpoints.some((n) => n.count > 2))
    throw new Error(
      "The selected curves branch. Ctrl-click to remove a branch and choose one path.",
    );
  const connected = connectedChain(curves[0]!, source);
  if (connected.length !== ids.length) {
    const open = endpoints.filter((e) => e.count === 1);
    let nearest = Infinity;
    for (let i = 0; i < open.length; i++)
      for (let j = i + 1; j < open.length; j++)
        nearest = Math.min(nearest, distance(open[i]!.point, open[j]!.point));
    const detail = Number.isFinite(nearest)
      ? ` Closest open ends are ${Number(nearest.toFixed(6))} mm apart.`
      : "";
    throw new Error(
      `The selected curves do not form one connected chain yet.${detail} Ctrl-click any missing connecting curves.`,
    );
  }
  return {
    entities: [
      ...entities,
      ...offsetRoundedChain(
        connected,
        curves[0]!.kind === "arc" ? -amount : amount,
      ),
    ],
    constraints: [...constraints],
    removedConstraints: 0,
    offsetChain: {
      closed:
        distance(chainStart(connected[0]!), chainEnd(connected.at(-1)!)) < EPS,
      endGap: distance(chainStart(connected[0]!), chainEnd(connected.at(-1)!)),
      ends: [chainStart(connected[0]!), chainEnd(connected.at(-1)!)],
    },
    ...(gaps.count ? { joinedGaps: gaps } : {}),
  };
}

/** Resolve auto-chaining once, so later edits cannot pick up unrelated curves. */
export function offsetSourceIds(
  entities: SketchEntity[],
  ids: string[],
  autoChain: boolean,
): string[] {
  const seed = entities.find((e) => e.id === ids[0]);
  if (
    ids.length !== 1 ||
    !autoChain ||
    !seed ||
    seed.kind === "point" ||
    seed.kind === "circle"
  )
    return [...ids];
  // Keep the selected seed first: it defines the sign of the distance.
  return [
    seed.id,
    ...connectedChain(seed, entities)
      .map((s) => s.g.e.id)
      .filter((id) => id !== seed.id),
  ];
}

/** Suggest only a unique existing connector; never invent a missing side. */
export function findOffsetConnector(
  entities: SketchEntity[],
  selectedIds: string[],
  ends: [XY, XY],
  tolerance = 0.01,
): string | null {
  const chosen = new Set(selectedIds),
    matches: string[] = [];
  for (const e of entities) {
    if (chosen.has(e.id) || (e.kind !== "line" && e.kind !== "arc")) continue;
    const g = geometry(e, entities),
      tol = Math.max(EPS, tolerance);
    if (
      (distance(g.a, ends[0]) <= tol && distance(g.b, ends[1]) <= tol) ||
      (distance(g.b, ends[0]) <= tol && distance(g.a, ends[1]) <= tol)
    )
      matches.push(e.id);
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** Repair near-coincident ends in a temporary offset source, never in the sketch. */
function joinOffsetEndpoints(
  curves: Curve[],
  source: SketchEntity[],
  tolerance: number,
) {
  type End = { curve: Curve; point: SketchPoint };
  const nodes: { ends: End[]; point: XY }[] = [];
  for (const curve of curves) {
    const ids =
      curve.kind === "line"
        ? [curve.p1, curve.p2]
        : curve.kind === "arc"
          ? [curve.start, curve.end]
          : [];
    for (const id of ids) {
      const point = source.find((e) => e.id === id) as SketchPoint;
      if (!point || point.kind !== "point")
        throw new Error("Sketch endpoint is missing.");
      const node = nodes.find((n) => distance(n.point, point) < EPS);
      if (node) node.ends.push({ curve, point });
      else
        nodes.push({
          point: { x: point.x, y: point.y },
          ends: [{ curve, point }],
        });
    }
  }
  const open = nodes.filter((n) => n.ends.length === 1);
  const candidates: { a: number; b: number; gap: number }[] = [];
  for (let a = 0; a < open.length; a++)
    for (let b = a + 1; b < open.length; b++) {
      if (open[a]!.ends[0]!.curve.id === open[b]!.ends[0]!.curve.id) continue;
      const gap = distance(open[a]!.point, open[b]!.point);
      if (gap <= tolerance && gap >= EPS) candidates.push({ a, b, gap });
    }
  candidates.sort((a, b) => a.gap - b.gap);
  const used = new Set<number>();
  let count = 0,
    maxDistance = 0;
  for (const { a, b, gap } of candidates) {
    if (used.has(a) || used.has(b)) continue;
    // Don't guess between multiple plausible neighbours.
    if (
      candidates.some(
        (c) =>
          (c.a === a || c.b === a || c.a === b || c.b === b) &&
          !(c.a === a && c.b === b) &&
          !used.has(c.a) &&
          !used.has(c.b),
      )
    )
      throw new Error(
        "Several endpoints fall within the join tolerance. Reduce the tolerance or select one clear path.",
      );
    const ea = open[a]!.ends[0]!,
      eb = open[b]!.ends[0]!;
    const ga = geometry(ea.curve, source),
      gb = geometry(eb.curve, source);
    let target: XY | undefined;
    if (ea.curve.kind === "line" && eb.curve.kind === "line") {
      target = {
        x: (ea.point.x + eb.point.x) / 2,
        y: (ea.point.y + eb.point.y) / 2,
      };
    } else if (ea.curve.kind === "line")
      target = { x: eb.point.x, y: eb.point.y };
    else if (eb.curve.kind === "line")
      target = { x: ea.point.x, y: ea.point.y };
    else {
      const hits = intersections(ga, gb).filter(
        (p) =>
          distance(p, ea.point) <= tolerance &&
          distance(p, eb.point) <= tolerance,
      );
      hits.sort(
        (p, q) =>
          distance(p, ea.point) +
          distance(p, eb.point) -
          distance(q, ea.point) -
          distance(q, eb.point),
      );
      target = hits[0];
      if (
        !target &&
        distance(ga.c, gb.c) < EPS &&
        Math.abs(ga.r - gb.r) < EPS
      ) {
        const mx = (ea.point.x + eb.point.x) / 2 - ga.c.x,
          my = (ea.point.y + eb.point.y) / 2 - ga.c.y;
        const length = Math.hypot(mx, my);
        if (length > EPS)
          target = {
            x: ga.c.x + (mx * ga.r) / length,
            y: ga.c.y + (my * ga.r) / length,
          };
      }
    }
    if (!target)
      throw new Error(
        "These arc ends cannot be joined without changing their radii. Adjust the source curves.",
      );
    ea.point.x = eb.point.x = target.x;
    ea.point.y = eb.point.y = target.y;
    used.add(a);
    used.add(b);
    count++;
    maxDistance = Math.max(maxDistance, gap);
  }
  return { count, maxDistance };
}

/** Offset one seed curve, optionally following its connected neighbours. */
export function offsetSketch(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  entityId: string,
  amount: number,
  chain = true,
): SketchModification {
  if (!Number.isFinite(amount) || Math.abs(amount) < EPS)
    throw new Error("Enter a non-zero offset distance in mm.");
  const entity = entities.find((e) => e.id === entityId);
  if (!entity || entity.kind === "point")
    throw new Error("Choose a line, circle, or arc to offset.");
  if (chain && entity.kind !== "circle") {
    const connected = connectedChain(entity, entities);
    if (connected.length > 1) {
      return {
        entities: [
          ...entities,
          ...offsetRoundedChain(
            connected,
            entity.kind === "arc" ? -amount : amount,
          ),
        ],
        constraints: [...constraints],
        removedConstraints: 0,
      };
    }
  }
  const g = geometry(entity, entities),
    added: SketchEntity[] = [];
  const point = (q: XY) => {
    const id = newId("p");
    added.push({ id, kind: "point", x: q.x, y: q.y });
    return id;
  };
  const line = (a: string, b: string) =>
    added.push({
      id: newId("l"),
      kind: "line",
      p1: a,
      p2: b,
      ...constructionOf(entity),
    });
  if (entity.kind === "line") {
    // Follow a simple closed line loop, stopping at branches/open ends.
    const loop = [g.a, g.b],
      used = new Set([entityId]);
    if (chain)
      while (distance(loop.at(-1)!, loop[0]!) > EPS) {
        const candidates = entities
          .filter(
            (e) =>
              e.kind === "line" &&
              !used.has(e.id) &&
              !!e.construction === !!entity.construction,
          )
          .map((e) => geometry(e as Curve, entities))
          .filter(
            (h) =>
              distance(h.a, loop.at(-1)!) < EPS ||
              distance(h.b, loop.at(-1)!) < EPS,
          );
        if (candidates.length !== 1) break;
        const h = candidates[0]!;
        used.add(h.e.id);
        loop.push(distance(h.a, loop.at(-1)!) < EPS ? h.b : h.a);
      }
    const closed = loop.length > 3 && distance(loop[0]!, loop.at(-1)!) < EPS;
    const shift = (a: XY, b: XY) => {
      const len = distance(a, b);
      if (len < EPS) throw new Error("Cannot offset a zero-length line.");
      return {
        x: a.x - ((b.y - a.y) * amount) / len,
        y: a.y + ((b.x - a.x) * amount) / len,
      };
    };
    if (closed) {
      const vertices = loop.slice(0, -1),
        n = vertices.length;
      const shifted = vertices.map((a, i) => {
        const prev = vertices[(i + n - 1) % n]!,
          next = vertices[(i + 1) % n]!;
        const p = shift(prev, a),
          q = shift(a, next),
          d = sub(a, prev),
          e = sub(next, a);
        const den = cross(d, e);
        if (Math.abs(den) < EPS) {
          if (dot(d, e) <= 0)
            throw new Error("Cannot offset a reversing corner.");
          return q;
        }
        const t = cross(sub(q, p), e) / den;
        return { x: p.x + t * d.x, y: p.y + t * d.y };
      });
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (
          dot(sub(shifted[j]!, shifted[i]!), sub(vertices[j]!, vertices[i]!)) <=
          EPS
        )
          throw new Error(
            "Offset collapses this loop. Use a smaller distance.",
          );
        for (let k = i + 2; k < n; k++) {
          if ((k + 1) % n === i) continue;
          const a = shifted[i]!,
            b = shifted[j]!,
            c = shifted[k]!,
            d = shifted[(k + 1) % n]!;
          const den = cross(sub(b, a), sub(d, c));
          if (Math.abs(den) < EPS) continue;
          const t = cross(sub(c, a), sub(d, c)) / den,
            u = cross(sub(c, a), sub(b, a)) / den;
          if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS)
            throw new Error("Offset crosses itself. Use a smaller distance.");
        }
      }
      const ids = shifted.map(point);
      ids.forEach((id, i) => line(id, ids[(i + 1) % n]!));
    } else {
      const a = shift(g.a, g.b),
        d = sub(g.b, g.a);
      line(point(a), point({ x: a.x + d.x, y: a.y + d.y }));
    }
  } else {
    const radius = g.r + amount;
    if (radius <= EPS)
      throw new Error("Offset would collapse the circle or arc.");
    const center = point(g.c);
    if (entity.kind === "circle")
      added.push({
        id: newId("c"),
        kind: "circle",
        center,
        radius,
        ...constructionOf(entity),
      });
    else {
      const scaled = (p: XY) => ({
        x: g.c.x + ((p.x - g.c.x) * radius) / g.r,
        y: g.c.y + ((p.y - g.c.y) * radius) / g.r,
      });
      added.push({
        id: newId("a"),
        kind: "arc",
        center,
        start: point(scaled(g.a)),
        end: point(scaled(g.b)),
        ...constructionOf(entity),
      });
    }
  }
  return {
    entities: [...entities, ...added],
    constraints: [...constraints],
    removedConstraints: 0,
  };
}

type ChainSegment = { g: Geometry; reversed: boolean };
const chainStart = (s: ChainSegment) => (s.reversed ? s.g.b : s.g.a);
const chainEnd = (s: ChainSegment) => (s.reversed ? s.g.a : s.g.b);

/** Walk both ways from the selected curve, keeping analytic arcs intact. */
function connectedChain(seed: Curve, entities: SketchEntity[]): ChainSegment[] {
  const all = entities
    .filter((e): e is Curve => e.kind === "line" || e.kind === "arc")
    .filter((e) => !!e.construction === !!seed.construction)
    .map((e) => geometry(e, entities));
  const chain: ChainSegment[] = [
    { g: geometry(seed, entities), reversed: false },
  ];
  const used = new Set([seed.id]);
  for (const atEnd of [true, false]) {
    while (distance(chainStart(chain[0]!), chainEnd(chain.at(-1)!)) > EPS) {
      const target = atEnd ? chainEnd(chain.at(-1)!) : chainStart(chain[0]!);
      const candidates = all.filter(
        (g) =>
          !used.has(g.e.id) &&
          (distance(g.a, target) < EPS || distance(g.b, target) < EPS),
      );
      if (!candidates.length) break;
      if (candidates.length > 1) break; // Stop at branches; never guess a path.
      const g = candidates[0]!;
      const segment = {
        g,
        reversed: atEnd
          ? distance(g.b, target) < EPS
          : distance(g.a, target) < EPS,
      };
      used.add(g.e.id);
      if (atEnd) chain.push(segment);
      else chain.unshift(segment);
    }
  }
  return chain;
}

function offsetRoundedChain(
  chain: ChainSegment[],
  amount: number,
): SketchEntity[] {
  const closed = distance(chainStart(chain[0]!), chainEnd(chain.at(-1)!)) < EPS;
  const shifted = chain.map(({ g, reversed }) => {
    if (g.e.kind === "line") {
      const length = distance(g.a, g.b);
      if (length < EPS) throw new Error("Cannot offset a zero-length line.");
      const sign = reversed ? -1 : 1;
      const delta = {
        x: (-(g.b.y - g.a.y) * amount * sign) / length,
        y: ((g.b.x - g.a.x) * amount * sign) / length,
      };
      return {
        a: { x: g.a.x + delta.x, y: g.a.y + delta.y },
        b: { x: g.b.x + delta.x, y: g.b.y + delta.y },
        c: g.c,
        r: 0,
      };
    }
    const r = g.r + (reversed ? amount : -amount);
    if (r <= EPS)
      throw new Error(
        "Offset would collapse a rounded corner. Use a smaller distance.",
      );
    const scale = (p: XY) => ({
      x: g.c.x + ((p.x - g.c.x) * r) / g.r,
      y: g.c.y + ((p.y - g.c.y) * r) / g.r,
    });
    return { a: scale(g.a), b: scale(g.b), c: g.c, r };
  });
  const geom = (i: number): Geometry => {
    const s = shifted[i]!;
    const e =
      chain[i]!.g.e.kind === "line"
        ? { id: "curve", kind: "line" as const, p1: "a", p2: "b" }
        : {
            id: "curve",
            kind: "arc" as const,
            start: "a",
            end: "b",
            center: "c",
          };
    return geometry(e, [
      e,
      ...(["a", "b", "c"] as const).map((id) => ({
        ...s[id],
        id,
        kind: "point" as const,
      })),
    ]);
  };
  for (let i = 0; i < chain.length - (closed ? 0 : 1); i++) {
    const j = (i + 1) % chain.length;
    const endKey = chain[i]!.reversed ? "a" : "b",
      startKey = chain[j]!.reversed ? "b" : "a";
    const a = shifted[i]![endKey],
      b = shifted[j]![startKey];
    let joint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (distance(a, b) > EPS) {
      const candidates = intersections(geom(i), geom(j));
      candidates.sort((p, q) => distance(p, joint) - distance(q, joint));
      if (!candidates.length)
        throw new Error(
          "Offset cannot connect these corners. Use a smaller distance or offset a single curve.",
        );
      joint = candidates[0]!;
    }
    shifted[i]![endKey] = joint;
    shifted[j]![startKey] = joint;
  }
  const curves = shifted.map((s, i) => {
    if (
      distance(s.a, s.b) < EPS ||
      (chain[i]!.g.e.kind === "line" &&
        dot(sub(s.b, s.a), sub(chain[i]!.g.b, chain[i]!.g.a)) <= EPS)
    )
      throw new Error("Offset collapses this chain. Use a smaller distance.");
    return geom(i);
  });
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 2; j < curves.length; j++) {
      if (closed && i === 0 && j === curves.length - 1) continue;
      if (
        intersections(curves[i]!, curves[j]!).some(
          (p) => curves[i]!.contains(p) && curves[j]!.contains(p),
        )
      )
        throw new Error("Offset crosses itself. Use a smaller distance.");
    }
  const added: SketchEntity[] = [];
  const pointIds = new Map<XY, string>();
  const point = (p: XY) => {
    const existing = pointIds.get(p);
    if (existing) return existing;
    const id = newId("p");
    added.push({ id, kind: "point", x: p.x, y: p.y });
    pointIds.set(p, id);
    return id;
  };
  shifted.forEach((s, i) => {
    const id = newId("e"),
      construction = constructionOf(chain[i]!.g.e);
    if (chain[i]!.g.e.kind === "line")
      added.push({
        id,
        kind: "line",
        p1: point(s.a),
        p2: point(s.b),
        ...construction,
      });
    else
      added.push({
        id,
        kind: "arc",
        center: point(s.c),
        start: point(s.a),
        end: point(s.b),
        ...construction,
      });
  });
  return added;
}
