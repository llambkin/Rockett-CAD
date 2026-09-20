import type { EdgeRef, SketchEntity } from "./model.js";
import type { EdgeInfo, PlaneFrame, Vec3 } from "./api.js";

/** Exact orthogonal projection of supported analytic edges, with stable child IDs. */
export function projectEdge(curve: EdgeInfo["curve"], frame: PlaneFrame, id: string,
  projection: EdgeRef, construction = true): SketchEntity[] {
  const uv = (p: Vec3) => {
    const d = p.map((v, i) => v - frame.origin[i]);
    return { x: d.reduce((v, a, i) => v + a * frame.xAxis[i], 0),
      y: d.reduce((v, a, i) => v + a * frame.yAxis[i], 0) };
  };
  const point = (suffix: string, p: Vec3): SketchEntity =>
    ({ id: `${id}:${suffix}`, kind: "point", ...uv(p), external: true, construction: true });
  const common = { id, projection, external: true, construction };
  if (curve.type === "line") {
    const a = uv(curve.a), b = uv(curve.b);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7)
      throw new Error("This edge projects to a point. Choose an edge visible in the sketch plane.");
    return [point("a", curve.a), point("b", curve.b),
      { ...common, kind: "line", p1: `${id}:a`, p2: `${id}:b` }];
  }
  if (curve.type === "circle") {
    const dot = curve.axis.reduce((v, a, i) => v + a * frame.normal[i], 0);
    if (Math.abs(dot) < 1 - 1e-6)
      throw new Error("Tilted circular edges project to ellipses, which the sketcher does not yet support.");
    if (curve.sweep !== undefined && Math.abs(curve.sweep) < Math.PI * 2 - 1e-6) {
      if (!curve.start || !curve.end) throw new Error("Missing arc endpoints.");
      const a = dot > 0 ? curve.start : curve.end, b = dot > 0 ? curve.end : curve.start;
      return [point("c", curve.center), point("a", a), point("b", b),
        { ...common, kind: "arc", center: `${id}:c`, start: `${id}:a`, end: `${id}:b` }];
    }
    return [point("c", curve.center),
      { ...common, kind: "circle", center: `${id}:c`, radius: curve.radius }];
  }
  throw new Error("Project currently supports straight edges, circles, and circular arcs.");
}
