interface ConstraintBase {
  id: string;
  labelOffset?: [number, number];
}

export type GeometricConstraint =
  | (ConstraintBase & { type: "coincident"; a: string; b: string })
  | (ConstraintBase & { type: "horizontal"; line: string })
  | (ConstraintBase & { type: "vertical"; line: string })
  | (ConstraintBase & { type: "parallel"; a: string; b: string })
  | (ConstraintBase & { type: "perpendicular"; a: string; b: string })
  | (ConstraintBase & { type: "tangent"; a: string; b: string })
  | (ConstraintBase & { type: "smooth"; a: string; b: string })
  | (ConstraintBase & { type: "concentric"; a: string; b: string })
  | (ConstraintBase & { type: "equal"; a: string; b: string })
  | (ConstraintBase & { type: "midpoint"; point: string; line: string })
  | (ConstraintBase & { type: "collinear"; a: string; b: string })
  | (ConstraintBase & { type: "symmetric"; a: string; b: string; line: string })
  | (ConstraintBase & { type: "fix"; point: string })
  | (ConstraintBase & { type: "pointOnLine"; point: string; line: string })
  | (ConstraintBase & { type: "pointOnCircle"; point: string; circle: string });

interface DimensionBase extends ConstraintBase {
  driven?: true;
}

export type DimensionConstraint =
  | (DimensionBase & {
      type: "distance";
      a: string;
      b: string;
      axis: "x" | "y" | null;
      value: number;
    })
  | (DimensionBase & { type: "length"; line: string; value: number })
  | (DimensionBase & {
      type: "pointLineDistance";
      point: string;
      line: string;
      value: number;
    })
  | (DimensionBase & {
      type: "lineDistance";
      a: string;
      b: string;
      value: number;
    })
  | (DimensionBase & {
      type: "lineAngle";
      line: string;
      axis?: "y";
      value: number;
    })
  | (DimensionBase & { type: "radius"; entity: string; value: number })
  | (DimensionBase & { type: "diameter"; entity: string; value: number })
  | (DimensionBase & { type: "angle"; a: string; b: string; value: number });

export type SketchConstraint = GeometricConstraint | DimensionConstraint;

export type SketchSolveStatus =
  | "unconstrained"
  | "partially_constrained"
  | "fully_constrained"
  | "over_constrained";
