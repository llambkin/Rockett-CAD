import type {
  PlaneFrame,
  SketchCurve,
  SketchCurveEllipse,
  Vec3,
} from "@rockett/shared";
import { arcAngles } from "@rockett/shared";
import {
  acquire,
  dir,
  getKernel,
  pnt,
  scoped,
  type Own,
  type Shape,
} from "./kernel.js";
import { bsplineCurve } from "./edgeCurve.js";
import { uvTo3d } from "./frames.js";

type UV = [number, number];
type Snap = (x: number, y: number) => UV;

interface CurvePiece {
  reversed: boolean;
  trim?: [number, number, number, number];
}

function axes(own: Own, frame: PlaneFrame, c: UV, x: Vec3, flip = false) {
  const k = getKernel();
  const [cx, cy, cz] = uvTo3d(frame, c[0], c[1]);
  const [nx, ny, nz] = frame.normal.map((v) => (flip ? -v : v));
  return own(
    new k.gp_Ax2_2(
      own(pnt(cx, cy, cz)),
      own(dir(nx!, ny!, nz!)),
      own(dir(x[0], x[1], x[2])),
    ),
  );
}

export function lineEdge(frame: PlaneFrame, a: UV, b: UV): Shape {
  const k = getKernel();
  const [p1, p2] = [uvTo3d(frame, ...a), uvTo3d(frame, ...b)];
  return acquire(
    scoped((own) =>
      own.keep(
        own(
          own(
            new k.BRepBuilderAPI_MakeEdge_3(own(pnt(...p1)), own(pnt(...p2))),
          ).Edge(),
        ),
      ),
    ),
  );
}

export function arcEdge(
  frame: PlaneFrame,
  c: { x: number; y: number },
  s: UV,
  e: UV,
  reversed = false,
): Shape {
  const k = getKernel();
  const { a0, a1, r } = arcAngles({
    cx: c.x,
    cy: c.y,
    sx: s[0],
    sy: s[1],
    ex: e[0],
    ey: e[1],
  });
  const amid = (a0 + a1) / 2;
  const [from, to] = reversed ? [e, s] : [s, e];
  const p1 = uvTo3d(frame, from[0], from[1]);
  const pm = uvTo3d(frame, c.x + r * Math.cos(amid), c.y + r * Math.sin(amid));
  const p2 = uvTo3d(frame, to[0], to[1]);
  return acquire(
    scoped((own) => {
      const arcMk = own(
        new k.GC_MakeArcOfCircle_4(
          own(pnt(...p1)),
          own(pnt(...pm)),
          own(pnt(...p2)),
        ),
      );
      const curve = own(k.upcastCurve(own(arcMk.Value())));
      return own.keep(own(own(new k.BRepBuilderAPI_MakeEdge_24(curve)).Edge()));
    }),
  );
}

function circleEdge(frame: PlaneFrame, c: UV, r: number): Shape {
  const k = getKernel();
  return acquire(
    scoped((own) => {
      const circ = own(new k.gp_Circ_2(axes(own, frame, c, frame.xAxis), r));
      return own.keep(own(own(new k.BRepBuilderAPI_MakeEdge_8(circ)).Edge()));
    }),
  );
}

function ellipseEdge(
  frame: PlaneFrame,
  e: SketchCurveEllipse,
  ends: [UV, UV] | undefined,
  reversed: boolean,
): Shape {
  const k = getKernel();
  const origin = uvTo3d(frame, e.cx, e.cy);
  const tip = uvTo3d(frame, e.cx + e.ux, e.cy + e.uy);
  const major = tip.map((v, i) => v - origin[i]!) as Vec3;
  return acquire(
    scoped((own) => {
      const ax2 = axes(own, frame, [e.cx, e.cy], major, reversed);
      const ellipse = own(new k.gp_Elips_2(ax2, e.a, e.b));
      const [from, to] = (reversed ? ends?.toReversed() : ends) ?? [];
      const made = own(
        from && to
          ? new k.BRepBuilderAPI_MakeEdge_14(
              ellipse,
              own(pnt(...uvTo3d(frame, ...from))),
              own(pnt(...uvTo3d(frame, ...to))),
            )
          : new k.BRepBuilderAPI_MakeEdge_12(ellipse),
      );
      if (!made.IsDone())
        throw new Error(`Ellipse ${e.id} does not pass through its ends.`);
      return own.keep(own(made.Edge()));
    }),
  );
}

function splineEdge(
  frame: PlaneFrame,
  s: Extract<SketchCurve, { kind: "spline" }>,
  snap: Snap,
  reversed: boolean,
): Shape {
  const k = getKernel();
  const last = s.poles.length - 1;
  const ends = (i: number) => !s.periodic && (i === 0 || i === last);
  return acquire(
    scoped((own) => {
      const curve = bsplineCurve(own, {
        ...s,
        poles: s.poles.map(([u, v], i) =>
          uvTo3d(frame, ...(ends(i) ? snap(u, v) : ([u, v] as UV))),
        ),
      });
      const handle = own(new k.Handle_Geom_Curve_2(curve));
      const edge = own(own(new k.BRepBuilderAPI_MakeEdge_24(handle)).Edge());
      return own.keep(
        reversed ? own(k.TopoDS.Edge_1(own(edge.Reversed()))) : edge,
      );
    }),
  );
}

export function pieceEdge(
  frame: PlaneFrame,
  curve: SketchCurve,
  piece: CurvePiece,
  snap: Snap,
): Shape {
  const t = piece.trim;
  const cut = ([a, b, c, d]: number[]): [UV, UV] => [
    snap(a!, b!),
    snap(c!, d!),
  ];
  if (curve.kind === "ellipse") {
    const span = curve.span && [...curve.span.s, ...curve.span.e];
    const ends = t ?? span;
    return ellipseEdge(frame, curve, ends && cut(ends), piece.reversed);
  }
  if (curve.kind === "spline")
    return splineEdge(frame, curve, snap, piece.reversed);
  if (curve.kind === "circle") {
    if (!t) return circleEdge(frame, [curve.cx, curve.cy], curve.r);
    const [s, e] = cut(t);
    return arcEdge(frame, { x: curve.cx, y: curve.cy }, s, e, piece.reversed);
  }
  const [s, e]: [UV, UV] = t
    ? cut(t)
    : curve.kind === "line"
      ? [snap(curve.x1, curve.y1), snap(curve.x2, curve.y2)]
      : [snap(...curve.s), snap(...curve.e)];
  if (curve.kind === "arc")
    return arcEdge(frame, { x: curve.cx, y: curve.cy }, s, e, piece.reversed);
  return piece.reversed ? lineEdge(frame, e, s) : lineEdge(frame, s, e);
}
