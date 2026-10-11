import type { PlaneFrame, Vec3 } from "./api.js";
import type { Instance } from "./assembly.js";
import type { TopoRef } from "./model.js";
import { Placement } from "./placement.js";

interface JointOrigin {
  path: [string, ...string[]];
  ref: TopoRef;
}

interface JointBase {
  id: string;
  name: string;
  a: JointOrigin;
  b: JointOrigin;
  flipped: boolean;
}

export type Joint =
  | (JointBase & { type: "rigid" })
  | (JointBase & {
      type: "revolute" | "slider";
      value: number;
      limits?: { min: number; max: number };
    });

export interface JointFrames {
  a: PlaneFrame;
  b: PlaneFrame;
}

type JointError = "overconstrained" | "unreachable" | "outsideLimits";

const Z: Vec3 = [0, 0, 1];

const FACE_TO_FACE = Placement.fromAxisAngle([1, 0, 0], Math.PI);

const fromFrame = ({ origin, xAxis, normal }: PlaneFrame): Placement => {
  const tilt = Placement.compose(
    Placement.fromAxisAngle(Z, Math.atan2(normal[1], normal[0])),
    Placement.fromAxisAngle(
      [0, 1, 0],
      Math.atan2(Math.hypot(normal[0], normal[1]), normal[2]),
    ),
  );
  const [x, y] = Placement.applyToDirection(Placement.invert(tilt), xAxis);
  return Placement.compose(
    Placement.fromTranslation(origin),
    Placement.compose(tilt, Placement.fromAxisAngle(Z, Math.atan2(y, x))),
  );
};

const motion = (joint: Joint): Placement => {
  if (joint.type === "rigid") return Placement.identity();
  if (joint.type === "slider")
    return Placement.fromTranslation([0, 0, joint.value]);
  return Placement.fromAxisAngle(Z, (joint.value * Math.PI) / 180);
};

const outsideLimits = (joint: Joint) =>
  joint.type !== "rigid" &&
  joint.limits !== undefined &&
  (joint.value < joint.limits.min || joint.value > joint.limits.max);

const aToB = (joint: Joint, frames: JointFrames): Placement =>
  [
    motion(joint),
    joint.flipped ? Placement.identity() : FACE_TO_FACE,
    Placement.invert(fromFrame(frames.b)),
  ].reduce(Placement.compose, fromFrame(frames.a));

export function solvePlacements(
  instances: readonly Instance[],
  joints: readonly Joint[],
  frames: ReadonlyMap<string, JointFrames>,
) {
  const errors = new Map<string, JointError>();
  const pending = new Map(
    joints.flatMap((j) => {
      const f = frames.get(j.id);
      return f ? [[j, f] as const] : [];
    }),
  );
  const reached = new Map(
    instances.filter((i) => i.grounded).map((i) => [i.id, i.placement]),
  );
  for (const [parent, at] of reached) {
    for (const [joint, f] of pending) {
      const forward = joint.a.path[0] === parent;
      if (!forward && joint.b.path[0] !== parent) continue;
      pending.delete(joint);
      const child = forward ? joint.b.path[0] : joint.a.path[0];
      if (reached.has(child)) {
        errors.set(joint.id, "overconstrained");
        continue;
      }
      if (outsideLimits(joint)) errors.set(joint.id, "outsideLimits");
      const relative = aToB(joint, f);
      reached.set(
        child,
        Placement.compose(at, forward ? relative : Placement.invert(relative)),
      );
    }
  }
  for (const joint of pending.keys()) errors.set(joint.id, "unreachable");
  const placements = new Map(
    instances.map((i) => [i.id, reached.get(i.id) ?? i.placement]),
  );
  return { placements, errors };
}
