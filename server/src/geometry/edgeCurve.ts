import type { EdgeInfo, ExactCurve, Vec3 } from "@rockett/shared";
import { getKernel, pnt, scoped, type Own, type Shape } from "./kernel.js";

type SpaceSpline = Omit<Extract<ExactCurve, { type: "bspline" }>, "type">;

const PARAM_TOL = 1e-9;

const at = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [
  p.X(),
  p.Y(),
  p.Z(),
];

export function bsplineCurve(own: Own, s: SpaceSpline) {
  const k = getKernel();
  const reals = (values: number[]) => {
    const out = own(new k.TColStd_Array1OfReal_2(1, values.length));
    values.forEach((v, i) => out.SetValue_1(i + 1, v));
    return out;
  };
  const poles = own(new k.TColgp_Array1OfPnt_2(1, s.poles.length));
  s.poles.forEach((p, i) => poles.SetValue_1(i + 1, own(pnt(...p))));
  const mults = own(new k.TColStd_Array1OfInteger_2(1, s.knots.length));
  s.multiplicities.forEach((m, i) => mults.SetValue_1(i + 1, m));
  const knots = reals(s.knots);
  const periodic = s.periodic ?? false;
  return s.weights
    ? new k.Geom_BSplineCurve_2(
        poles,
        reals(s.weights),
        knots,
        mults,
        s.degree,
        periodic,
        true,
      )
    : new k.Geom_BSplineCurve_1(poles, knots, mults, s.degree, periodic);
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function splineData(own: Own, curve: any): SpaceSpline {
  const poles = range(curve.NbPoles());
  const knots = range(curve.NbKnots());
  return {
    degree: curve.Degree(),
    poles: poles.map((i) => at(own(curve.Pole(i)))),
    ...(curve.IsRational() && { weights: poles.map((i) => curve.Weight(i)) }),
    knots: knots.map((i) => curve.Knot(i)),
    multiplicities: knots.map((i) => curve.Multiplicity(i)),
    ...(curve.IsPeriodic() && { periodic: true }),
  };
}

function edgeSpline(own: Own, adaptor: any): ExactCurve {
  const k = getKernel();
  const whole = splineData(own, own(adaptor.BSpline()).get());
  const [first, last] = [adaptor.FirstParameter(), adaptor.LastParameter()];
  const [lo, hi] = [whole.knots[0]!, whole.knots.at(-1)!];
  const full = whole.periodic
    ? Math.abs(last - first - (hi - lo)) <= PARAM_TOL
    : Math.abs(first - lo) <= PARAM_TOL && Math.abs(last - hi) <= PARAM_TOL;
  if (full) return { type: "bspline", ...whole };
  const piece = own(new k.Handle_Geom_BSplineCurve_2(bsplineCurve(own, whole)));
  piece.get().Segment(first, last, PARAM_TOL);
  return { type: "bspline", ...splineData(own, piece.get()) };
}

function analytic(own: Own, curve: any): EdgeInfo["curve"] {
  const k = getKernel();
  const type = curve.GetType();
  const ends = () => ({
    start: at(own(curve.Value(curve.FirstParameter()))),
    end: at(own(curve.Value(curve.LastParameter()))),
    sweep: curve.LastParameter() - curve.FirstParameter(),
  });
  if (type === k.GeomAbs_CurveType.GeomAbs_Line) {
    const { start, end } = ends();
    return { type: "line", a: start, b: end };
  }
  if (type === k.GeomAbs_CurveType.GeomAbs_Circle) {
    const circ = own(curve.Circle());
    return {
      type: "circle",
      center: at(own(circ.Location())),
      axis: at(own(own(circ.Axis()).Direction())),
      radius: circ.Radius(),
      ...ends(),
    };
  }
  if (type === k.GeomAbs_CurveType.GeomAbs_Ellipse) {
    const el = own(curve.Ellipse());
    return {
      type: "ellipse",
      center: at(own(el.Location())),
      axis: at(own(own(el.Axis()).Direction())),
      majorAxis: at(own(own(el.XAxis()).Direction())),
      majorRadius: el.MajorRadius(),
      minorRadius: el.MinorRadius(),
      ...ends(),
    };
  }
  return { type: "other" };
}

function described<T extends ExactCurve>(
  edge: Shape,
  read: (own: Own, adaptor: any) => T,
): T | { type: "other" } {
  try {
    return scoped((own) =>
      read(own, own(new (getKernel().BRepAdaptor_Curve_2)(edge))),
    );
  } catch {
    return { type: "other" };
  }
}

export function curveInfo(edge: Shape): EdgeInfo["curve"] {
  return described(edge, analytic);
}

export function exactCurve(edge: Shape): ExactCurve {
  return described(edge, (own, adaptor) => {
    const curve = analytic(own, adaptor);
    return curve.type === "other" &&
      adaptor.GetType() === getKernel().GeomAbs_CurveType.GeomAbs_BSplineCurve
      ? edgeSpline(own, adaptor)
      : curve;
  });
}
